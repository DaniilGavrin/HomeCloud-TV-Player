//! KAN-33: local-only discovery of HomeCloud Go WebSocket servers.
//!
//! No multicast protocol / no backend change required. We probe Go's current
//! `GET /healthz` and check that `/ws` accepts an actual WebSocket upgrade.
//! Critically: NO `hello` is sent while scanning, so discovery does not register
//! hundreds of fake clients in the Go device registry.

use std::{
    collections::{BTreeSet, HashSet},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use network_interface::{Addr, NetworkInterface, NetworkInterfaceConfig};
use serde::Serialize;
use serde_json::Value;
use tauri::State;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpSocket, TcpStream},
    time::timeout,
};
use tokio_tungstenite::client_async;

const DEFAULT_WS_PORT: u16 = 8080;
const MAX_ADDRS: usize = 1024;
const CONCURRENCY: usize = 48;
const TCP_TIMEOUT: Duration = Duration::from_millis(650);
const HTTP_TIMEOUT: Duration = Duration::from_millis(1100);
const WS_TIMEOUT: Duration = Duration::from_millis(1100);

#[derive(Default)]
pub struct DiscoveryRuntime {
    generation: AtomicU64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredServer {
    ip: String,
    url: String,
    interface: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    servers: Vec<DiscoveredServer>,
    networks: Vec<String>,
    checked: usize,
    truncated: bool,
}

#[derive(Clone)]
struct Candidate {
    ip: Ipv4Addr,
    source: Ipv4Addr,
    interface: String,
}

fn virtual_network(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "tailscale", "wireguard", "wintun", "openvpn", "vpn", "tap-", "tun-",
        "zerotier", "radmin", "hamachi", "virtual", "hyper-v", "vmware",
        "virtualbox", "vethernet", "docker", "veth", "loopback", "pseudo-interface",
        "подключение через vpn", "виртуаль", "виртуальный",
    ]
    .iter()
    .any(|needle| n.contains(needle))
}

fn prefix_length(netmask: Ipv4Addr) -> Option<u32> {
    let mask = u32::from(netmask);
    let prefix = mask.leading_ones();
    let expected = if prefix == 0 { 0 } else { !0u32 << (32 - prefix) };
    (mask == expected && prefix >= 16 && prefix <= 30).then_some(prefix)
}

fn subnet_candidates(local: Ipv4Addr, mask: Ipv4Addr) -> Vec<Ipv4Addr> {
    if !local.is_private() { return Vec::new(); }
    let Some(prefix) = prefix_length(mask) else { return Vec::new(); };
    // Allow /23 (510 hosts), /24 (254), and smaller actual LAN networks.
    // For huge /16 or /8 corporate/VPN ranges, limit to the current /24.
    let scanned_prefix = prefix.max(23);
    let netmask = !0u32 << (32 - scanned_prefix);
    let base = u32::from(local) & netmask;
    let broadcast = base | !netmask;
    ((base + 1)..broadcast).map(Ipv4Addr::from).collect()
}

fn candidates() -> Result<(Vec<Candidate>, Vec<String>, bool), String> {
    let interfaces = NetworkInterface::show()
        .map_err(|e| format!("Не удалось прочитать сетевые интерфейсы: {e}"))?;
    let mut all = Vec::new();
    let mut networks = BTreeSet::new();
    let mut seen = HashSet::new();
    let mut truncated = false;

    for iface in interfaces {
        if iface.internal || virtual_network(&iface.name) { continue; }
        // A physical NIC generally has a MAC; permit adapters without a MAC
        // only if clearly named as Ethernet/Wi-Fi. Avoid scanning tunnel IPs.
        let lower = iface.name.to_lowercase();
        let physical_name = ["ethernet", "wi-fi", "wifi", "wireless", "wlan", "lan", "беспровод", "ethernet"].iter().any(|key| lower.contains(key));
        if iface.mac_addr.as_ref().is_none_or(|v| v.is_empty()) && !physical_name { continue; }

        for addr in iface.addr {
            let Addr::V4(ipv4) = addr else { continue; };
            let Some(mask) = ipv4.netmask else { continue; };
            let hosts = subnet_candidates(ipv4.ip, mask);
            if hosts.is_empty() { continue; }
            networks.insert(format!("{} · {}/{}", iface.name, ipv4.ip, prefix_length(mask).unwrap_or(0)));
            for host in hosts {
                if !seen.insert(host) { continue; }
                if all.len() >= MAX_ADDRS { truncated = true; break; }
                all.push(Candidate { ip: host, source: ipv4.ip, interface: iface.name.clone() });
            }
            if truncated { break; }
        }
        if truncated { break; }
    }
    Ok((all, networks.into_iter().collect(), truncated))
}

async fn bound_connection(source: Ipv4Addr, target: Ipv4Addr) -> Option<TcpStream> {
    let socket = TcpSocket::new_v4().ok()?;
    socket.bind(SocketAddr::V4(SocketAddrV4::new(source, 0))).ok()?;
    let destination = SocketAddr::V4(SocketAddrV4::new(target, DEFAULT_WS_PORT));
    timeout(TCP_TIMEOUT, socket.connect(destination)).await.ok()?.ok()
}

async fn health_matches(candidate: &Candidate) -> bool {
    let Some(mut socket) = bound_connection(candidate.source, candidate.ip).await else {
        return false;
    };
    let request = format!(
        "GET /healthz HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        candidate.ip, DEFAULT_WS_PORT
    );
    let response = async {
        socket.write_all(request.as_bytes()).await?;
        let mut received = Vec::with_capacity(512);
        let mut chunk = [0u8; 512];
        loop {
            if received.len() >= 2048 { break; }
            let count = socket.read(&mut chunk).await?;
            if count == 0 { break; }
            received.extend_from_slice(&chunk[..count]);
            if let Some(body_start) = received.windows(4).position(|b| b == b"\r\n\r\n") {
                let headers = &received[..body_start];
                if !headers.starts_with(b"HTTP/1.1 200 ") && !headers.starts_with(b"HTTP/1.0 200 ") {
                    return Ok(false);
                }
                if let Ok(json) = serde_json::from_slice::<Value>(&received[body_start + 4..]) {
                    return Ok(json.get("status").and_then(Value::as_str) == Some("ok"));
                }
            }
        }
        Ok::<bool, std::io::Error>(false)
    };
    timeout(HTTP_TIMEOUT, response).await.ok().and_then(Result::ok).unwrap_or(false)
}

async fn websocket_upgrade(candidate: &Candidate) -> bool {
    let Some(socket) = bound_connection(candidate.source, candidate.ip).await else {
        return false;
    };
    let url = format!("ws://{}:{}/ws", candidate.ip, DEFAULT_WS_PORT);
    match timeout(WS_TIMEOUT, client_async(url.as_str(), socket)).await {
        Ok(Ok((mut ws, _))) => {
            // Close BEFORE sending HomeCloud hello; do not create a client record.
            let _ = timeout(Duration::from_millis(300), ws.close(None)).await;
            true
        }
        _ => false,
    }
}

async fn probe(candidate: Candidate) -> Option<DiscoveredServer> {
    if !health_matches(&candidate).await { return None; }
    if !websocket_upgrade(&candidate).await { return None; }
    Some(DiscoveredServer {
        ip: candidate.ip.to_string(),
        url: format!("ws://{}:{}/ws", candidate.ip, DEFAULT_WS_PORT),
        interface: candidate.interface,
    })
}

#[tauri::command]
pub async fn discover_lan_servers(runtime: State<'_, DiscoveryRuntime>) -> Result<DiscoveryResult, String> {
    let generation = runtime.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let (hosts, networks, truncated) = candidates()?;
    let checked = hosts.len();
    let mut stream = futures_util::stream::iter(hosts.into_iter().map(probe))
        .buffer_unordered(CONCURRENCY);
    let mut servers = Vec::new();
    while let Some(found) = stream.next().await {
        if runtime.generation.load(Ordering::SeqCst) != generation {
            return Err("Поиск отменён".to_owned());
        }
        if let Some(server) = found { servers.push(server); }
    }
    servers.sort_by(|a, b| a.ip.parse::<Ipv4Addr>().ok().cmp(&b.ip.parse::<Ipv4Addr>().ok()));
    Ok(DiscoveryResult { servers, networks, checked, truncated })
}

#[tauri::command]
pub async fn cancel_lan_discovery(runtime: State<'_, DiscoveryRuntime>) -> Result<(), String> {
    runtime.generation.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn home_subnet_only() {
        let ip = Ipv4Addr::new(192, 168, 39, 11);
        let hosts = subnet_candidates(ip, Ipv4Addr::new(255,255,255,0));
        assert_eq!(hosts.len(), 254);
        assert!(hosts.contains(&Ipv4Addr::new(192,168,39,147)));
        assert!(!hosts.contains(&Ipv4Addr::new(192,168,40,1)));
    }
    #[test]
    fn broad_network_is_bounded() {
        let hosts = subnet_candidates(Ipv4Addr::new(10,7,8,11), Ipv4Addr::new(255,0,0,0));
        assert_eq!(hosts.len(), 254);
        assert_eq!(hosts[0], Ipv4Addr::new(10,7,8,1));
    }
    #[test]
    fn no_tailscale_or_loopback() {
        assert!(subnet_candidates(Ipv4Addr::new(100,82,22,45), Ipv4Addr::new(255,192,0,0)).is_empty());
        assert!(subnet_candidates(Ipv4Addr::LOCALHOST, Ipv4Addr::new(255,0,0,0)).is_empty());
        assert!(virtual_network("Tailscale"));
        assert!(virtual_network("WireGuard Tunnel"));
    }
}
