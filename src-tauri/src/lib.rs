use std::sync::{atomic::{AtomicU64, Ordering}, Arc};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};

struct ActiveConnection {
    sender: mpsc::Sender<String>,
    stop: oneshot::Sender<()>,
}

#[derive(Default)]
struct WsRuntime {
    active: Mutex<Option<ActiveConnection>>,
    generation: Arc<AtomicU64>,
}

#[derive(serde::Serialize, Clone)]
struct WsStatus<'a> {
    status: &'a str,
    detail: &'a str,
}

fn publish_status(app: &AppHandle, status: &str, detail: &str) {
    let _ = app.emit("tv-player-ws-status", WsStatus { status, detail });
}

#[tauri::command]
async fn ws_connect(
    app: AppHandle,
    runtime: State<'_, WsRuntime>,
    url: String,
    device_id: String,
) -> Result<(), String> {
    let url = url.trim().to_string();
    if !url.starts_with("ws://") && !url.starts_with("wss://") {
        return Err("Expected ws:// or wss:// URL".to_string());
    }
    if device_id.is_empty() || device_id.len() > 128 ||
        !device_id.chars().all(|c| c.is_ascii_alphanumeric() || "_.:-".contains(c)) {
        return Err("Invalid device_id".to_string());
    }

    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(8), connect_async(url.as_str()))
        .await
        .map_err(|_| "Connection timed out".to_string())?
        .map_err(|e| format!("WebSocket connect failed: {e}"))?;

    let hello = json!({
        "v": 1, "id": "tv-player-hello", "type": "hello",
        "device_id": device_id, "client_type": "tv"
    });
    tokio::time::timeout(
        Duration::from_secs(5),
        socket.send(Message::Text(hello.to_string().into())),
    )
    .await
    .map_err(|_| "hello write timed out".to_string())?
    .map_err(|e| format!("hello write failed: {e}"))?;

    let first = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .map_err(|_| "hello response timed out".to_string())?
        .ok_or_else(|| "Server closed before identification".to_string())?
        .map_err(|e| format!("hello response failed: {e}"))?;
    let Message::Text(reply) = first else {
        return Err("Expected JSON 'identified' message from HomeCloud".into());
    };
    let response: Value = serde_json::from_str(reply.as_str())
        .map_err(|e| format!("Invalid server hello response: {e}"))?;
    if response.get("type").and_then(Value::as_str) != Some("identified") {
        return Err(format!("HomeCloud rejected identification: {reply}"));
    }

    let (sender, mut receiver) = mpsc::channel::<String>(64);
    let (stop, mut stop_receiver) = oneshot::channel::<()>();
    let generation = runtime.generation.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut active = runtime.active.lock().await;
        if let Some(previous) = active.take() {
            let _ = previous.stop.send(());
        }
        *active = Some(ActiveConnection { sender, stop });
    }
    publish_status(&app, "connected", "HomeCloud hello identified");

    let current_generation = runtime.generation.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut stop_receiver => { break; }
                outgoing = receiver.recv() => {
                    let Some(payload) = outgoing else { break; };
                    if let Err(err) = socket.send(Message::Text(payload.into())).await {
                        publish_status(&app, "error", &format!("WS send: {err}"));
                        break;
                    }
                }
                incoming = socket.next() => {
                    match incoming {
                        Some(Ok(Message::Text(data))) => {
                            let _ = app.emit("tv-player-ws-message", data.to_string());
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Err(err)) => {
                            publish_status(&app, "error", &format!("WS receive: {err}"));
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
        let _ = socket.send(Message::Close(None)).await;
        if current_generation.load(Ordering::SeqCst) == generation {
            publish_status(&app, "disconnected", "WebSocket closed");
        }
    });
    Ok(())
}

#[tauri::command]
async fn ws_send(runtime: State<'_, WsRuntime>, payload: String) -> Result<(), String> {
    if payload.len() > 65_536 {
        return Err("Message exceeds HomeCloud WS payload limit".into());
    }
    serde_json::from_str::<Value>(&payload)
        .map_err(|e| format!("Invalid JSON payload: {e}"))?;
    let sender = {
        let active = runtime.active.lock().await;
        active.as_ref().ok_or("Not connected")?.sender.clone()
    };
    sender.send(payload).await.map_err(|_| "Connection no longer active".to_string())
}

#[tauri::command]
async fn ws_disconnect(app: AppHandle, runtime: State<'_, WsRuntime>) -> Result<(), String> {
    runtime.generation.fetch_add(1, Ordering::SeqCst);
    if let Some(active) = runtime.active.lock().await.take() {
        let _ = active.stop.send(());
    }
    publish_status(&app, "disconnected", "Disconnected by user");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WsRuntime::default())
        .invoke_handler(tauri::generate_handler![ws_connect, ws_send, ws_disconnect])
        .run(tauri::generate_context!())
        .expect("error while running TV Player");
}
