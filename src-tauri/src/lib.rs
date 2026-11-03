mod discovery;
use std::{
    sync::{atomic::{AtomicU64, Ordering}, Arc},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Default)]
struct WsRuntime {
    // A new connection or explicit disconnect invalidates all earlier attempts.
    generation: Arc<AtomicU64>,
    stop: Mutex<Option<oneshot::Sender<()>>>,
    outbound: Mutex<Option<mpsc::Sender<String>>>,
}

#[derive(Clone, Serialize)]
struct WsStatus<'a> {
    status: &'a str,
    detail: &'a str,
}

fn emit_status(app: &AppHandle, status: &str, detail: &str) {
    let _ = app.emit("tv-player-ws-status", WsStatus { status, detail });
}

fn validate_device_id(device_id: &str) -> bool {
    !device_id.is_empty()
        && device_id.len() <= 128
        && device_id.bytes().next().is_some_and(|first| first.is_ascii_alphanumeric())
        && device_id.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
}

/// Establishes a *real* Go WebSocket connection and waits for HomeCloud's
/// `identified` response before reporting success to React.
#[tauri::command]
async fn ws_connect(
    app: AppHandle,
    runtime: State<'_, WsRuntime>,
    url: String,
    device_id: String,
) -> Result<(), String> {
    let url = url.trim().to_owned();
    if !(url.starts_with("ws://") || url.starts_with("wss://")) {
        return Err("Ожидается адрес ws:// или wss://".into());
    }
    if !validate_device_id(&device_id) {
        return Err("Некорректный идентификатор TV Player".into());
    }

    // Invalidate and stop the previous connection, if any.
    let attempt = runtime.generation.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(stop) = runtime.stop.lock().await.take() {
        let _ = stop.send(());
    }
    *runtime.outbound.lock().await = None;

    let (mut socket, _) = tokio::time::timeout(
        Duration::from_secs(9), connect_async(url.as_str()),
    ).await
        .map_err(|_| "Время подключения к серверу истекло".to_string())?
        .map_err(|e| format!("Ошибка подключения WebSocket: {e}"))?;

    if runtime.generation.load(Ordering::SeqCst) != attempt {
        return Err("Подключение отменено".into());
    }

    let hello = json!({
        "v": 1,
        "id": "tv-player-hello",
        "type": "hello",
        "device_id": device_id,
        "client_type": "tv"
    });

    tokio::time::timeout(
        Duration::from_secs(5),
        socket.send(Message::Text(hello.to_string().into())),
    ).await
        .map_err(|_| "Время отправки hello истекло".to_string())?
        .map_err(|e| format!("Ошибка отправки hello: {e}"))?;

    let first = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .map_err(|_| "Сервер не ответил на hello вовремя".to_string())?
        .ok_or_else(|| "Сервер закрыл соединение до идентификации".to_string())?
        .map_err(|e| format!("Ошибка ответа сервера: {e}"))?;

    let Message::Text(response) = first else {
        return Err("Сервер не ответил JSON-сообщением identified".into());
    };
    let parsed: Value = serde_json::from_str(response.as_str())
        .map_err(|e| format!("Некорректный JSON от сервера: {e}"))?;
    if parsed.get("type").and_then(Value::as_str) != Some("identified") {
        return Err(format!("Сервер не подтвердил подключение: {response}"));
    }

    let (tx, mut rx) = oneshot::channel::<()>();
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<String>(128);
    {
        let mut active = runtime.stop.lock().await;
        if runtime.generation.load(Ordering::SeqCst) != attempt {
            return Err("Подключение отменено".into());
        }
        *active = Some(tx);
    }
    *runtime.outbound.lock().await = Some(outbound_tx);

    emit_status(&app, "connected", "Сервер подтвердил подключение");
    let generation = runtime.generation.clone();
    tauri::async_runtime::spawn(async move {
        // Subscribe before requesting a snapshot; no gap between stream and
        // snapshot after reconnect. The UI disregards older versions.
        for topic in ["media.room.changed", "media.room.closed"] {
            let req = json!({"v":1,"id":format!("tv-sub-{topic}"),"type":"subscribe","topic":topic});
            if socket.send(Message::Text(req.to_string().into())).await.is_err() { return; }
        }
        let snapshot = json!({"v":1,"id":"tv-init-snapshot","type":"command","action":"media.rooms.snapshot","data":{}});
        if socket.send(Message::Text(snapshot.to_string().into())).await.is_err() { return; }
        loop {
            tokio::select! {
                _ = &mut rx => break,
                outgoing = outbound_rx.recv() => match outgoing {
                    Some(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() { break; }
                    }
                    None => break,
                },
                next = socket.next() => match next {
                    Some(Ok(Message::Ping(_))) => {
                        // tungstenite queues automatic PONG; flush its queued reply.
                        if socket.flush().await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    Some(Ok(Message::Text(raw))) => {
                        if let Ok(message) = serde_json::from_str::<Value>(raw.as_str()) {
                            // The event contains ONLY control metadata; video bytes
                            // never travel through this Backend socket.
                            if generation.load(Ordering::SeqCst) == attempt {
                                let _ = app.emit("tv-player-ws-message", message);
                            }
                        }
                    }
                    Some(Ok(_)) => {}
                },
            }
        }
        let _ = socket.close(None).await;
        if generation.load(Ordering::SeqCst) == attempt {
            emit_status(&app, "disconnected", "Соединение с сервером прервано");
        }
    });
    Ok(())
}

// The frontend may issue only known media control/observation actions.
// In particular it cannot send arbitrary JSON from an untrusted page.
#[tauri::command]
async fn ws_media_command(
    runtime: State<'_, WsRuntime>, action: String, data: Value, id: String,
) -> Result<(), String> {
    if !matches!(action.as_str(),
        "media.rooms.snapshot" | "media.room.heartbeat" | "media.room.participant" |
        "media.room.control" | "media.room.control.ack" | "media.room.report") {
        return Err("Unsupported TV command".into());
    }
    if id.is_empty() || id.len() > 128 || !data.is_object() {
        return Err("Invalid TV command payload".into());
    }
    let sender = runtime.outbound.lock().await.clone().ok_or("TV is not connected")?;
    let msg = json!({"v":1,"id":id,"type":"command","action":action,"data":data});
    sender.send(msg.to_string()).await.map_err(|_| "TV control channel disconnected".to_string())
}

#[tauri::command]
async fn ws_disconnect(app: AppHandle, runtime: State<'_, WsRuntime>) -> Result<(), String> {
    runtime.generation.fetch_add(1, Ordering::SeqCst);
    *runtime.outbound.lock().await = None;
    if let Some(stop) = runtime.stop.lock().await.take() {
        let _ = stop.send(());
    }
    emit_status(&app, "disconnected", "Подключение отменено");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WsRuntime::default())
        .manage(discovery::DiscoveryRuntime::default())
        .invoke_handler(tauri::generate_handler![ws_connect, ws_disconnect, ws_media_command, discovery::discover_lan_servers, discovery::cancel_lan_discovery])
        .run(tauri::generate_context!())
        .expect("error while running TV Player");
}
