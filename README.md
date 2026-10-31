# HomeCloud TV Player

A standalone Tauri 2, React 19, TypeScript, Tailwind 3.4 desktop/TV client.

- **Project / Rust crate / npm package:** `hc_tv_player`
- **App title / Tauri productName:** `TV Player`
- **Tauri bundle identifier:** `rs.bytewizard.hctvplayer`
- **WebSocket transport:** Rust (`tokio-tungstenite`), not `new WebSocket()` in React.
- **Go handshake:** JSON v1 `hello` with persistent local `device_id` and `client_type=tv`.

## Develop

```cmd
npm run tauri dev
```

## Build

```cmd
npm run tauri build
```

## Structure

- `src/App.tsx`: initial connection/diagnostic UI, calls Tauri `invoke`.
- `src/App.css`: Tailwind v3 directives and global layout.
- `src-tauri/src/lib.rs`: Rust WS connection, hello, async event forwarding and commands.
- `src-tauri/tauri.conf.json`: app product metadata and window title.

## Scope

This is a **working communication foundation**, not a finished media player.
Actual video playback, media protocol, codecs, D-pad/remote navigation, discovery,
reconnect/backoff and multi-node server pool require separate design/implementation.
For LAN or tailnet use a private WS endpoint (for example `ws://100.x.y.z:8080/ws`).

The initial window is 1280x720 and resizable for desktop development.
After TV layout/remote behavior is ready, configure fullscreen/kiosk for the target device.
