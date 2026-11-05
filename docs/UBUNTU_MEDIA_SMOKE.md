# Real HomeCloud media test — Ubuntu HC SS + Backend + Media Gateway + Android TV

This is a **manual test plan**, not a claim that remote playback is tested.
All three Go components must run against the **same Backend**. Do not leave TV
connected to a separate Windows Backend when the HC Storage Service is
registered to the Ubuntu Backend; cross-node Media Room routing is not
implemented in this test.

## Test architecture

```
Android TV --WS--> HomeCloudBackend 192.168.0.147:8080
   |                       |
   | media.room.offer      | Media Gateway supervised child process
   v                       v
Gateway 192.168.0.147:8091 <-- stat/read (loopback HCS1) --
          HTTP Range        HC Storage Service 127.0.0.1:8092
               <-- file /mnt/storage/demo.mp4
```

Use TV Player built from the merged `main` and install its APK on Android TV.

## 1. Check current files and processes BEFORE changing configs

```bash
cd /root/homecloud
git -C HomeCloudBackend pull --ff-only
git -C HomeCloud-Storage-Service pull --ff-only
ls -l /root/homecloud/bin
ss -lntp | grep -E ':(8080|8091|8092)\\b' || true
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8092/readyz
```

Get the latest **successful** signed/released executables, not arbitrary
source builds (the old Go 1.22 from Ubuntu apt is too old):

```bash
mkdir -p /root/homecloud/bin /root/homecloud/staging
cd /root/homecloud/staging

BACKEND_SHA=$(gh api repos/DaniilGavrin/HomeCloudBackend/commits/main --jq .sha)
GATEWAY_SHA=$(gh api repos/DaniilGavrin/HomeCloud-Media-Gateway/commits/main --jq .sha)

gh release download "backend-build-$BACKEND_SHA" --repo DaniilGavrin/HomeCloudBackend \
  --pattern HomeCloudBackend-linux-amd64 --clobber
gh release download "build-$GATEWAY_SHA" --repo DaniilGavrin/HomeCloud-Media-Gateway \
  --pattern HomeCloudMediaGateway-linux-amd64 --clobber

# The Storage Service publishes ACTIONS ARTIFACTS, not a Github Release.
gh run list --repo DaniilGavrin/HomeCloud-Storage-Service --workflow go.yml --branch main \
  --status success --limit 3
# Pick the run corresponding to current main. Replace RUN_ID appropriately.
# gh run download RUN_ID --repo DaniilGavrin/HomeCloud-Storage-Service \
#   --name "hc-storage-service-FULL_COMMIT_SHA" --dir .

file HomeCloudBackend-linux-amd64 HomeCloudMediaGateway-linux-amd64
chmod +x HomeCloudBackend-linux-amd64 HomeCloudMediaGateway-linux-amd64
```

Move downloaded binaries into `/root/homecloud/bin` only during a controlled
restart (renaming temporary files atomically); keep old copies for rollback.

## 2. Storage Service HCS1 (same host, loopback-only)

Back up the live config:

```bash
cp -a /root/homecloud/storage-service.json \
  "/root/homecloud/storage-service.json.bak.$(date +%Y%m%d-%H%M%S)"
```

Use Python to **edit** the existing JSON (preserves storage_node_id identity,
data_dir, existing roots and Backend address):

```bash
python3 - <<'PY'
import json
from pathlib import Path
p=Path('/root/homecloud/storage-service.json')
j=json.loads(p.read_text())
j['source_ws']={'enabled':True,'allowed_gateway_ips':['127.0.0.1']}
j['http_listen']='127.0.0.1:8092'
assert any(r.get('id')=='storage-hdd' and r.get('kind')=='disk' and
    r.get('path')=='/mnt/storage' and r.get('allow_read') for r in j['roots'])
p.write_text(json.dumps(j,indent=2,ensure_ascii=False)+'\n')
print('Storage source_ws ready: 127.0.0.1:8092, peer 127.0.0.1 only')
PY
```

Never open port 8092 to the internet or allow an arbitrary peer.
This is a **no-app-auth LAN installation**, so the exact-peer firewall
boundary matters. The new source protocol is independent of Backend control WS.

For initial tests, place a short, supported H.264/AAC `.mp4` or MP3 file
under `/mnt/storage` (for example `/mnt/storage/demo.mp4`).
The filename is a relative root path, not `/dev/sdb`.

## 3. Gateway startup config

```bash
cat > /root/homecloud/gateway-runtime.yaml <<'YAML'
config_version: 1
server:
  host: "auto_private"
  port: 8091
  websocket_path: "/ws/stream"
  shutdown_timeout: "10s"
backend:
  websocket_url: "ws://127.0.0.1:8080/ws"
heartbeat:
  interval: "20s"
  grace: "10s"
storage:
  source_nodes:
    c671fd9c-2338-44e5-b09f-23a62ca9656c: "ws://127.0.0.1:8092/ws/source"
  local_roots:
    "disk:storage-hdd": "/mnt/storage"
  cache_dir: "data/media-cache"
  prefetch_limit_bytes: 1073741824
  max_cache_bytes: 10737418240
limits:
  max_rooms: 4
YAML
```

The Storage node UUID shown above is the one previously registered on this
Ubuntu machine. Check current `/root/homecloud/storage-service.log` first;
update this YAML if the UUID differs. `local_roots` is allowed because the
Gateway and HC SS both run on **the same Ubuntu host**.

## 4. Enable Backend's companion supervision

In `/root/homecloud/HomeCloudBackend/config/config.yaml`, edit or insert
exactly one top-level `media_gateway` block:

```yaml
media_gateway:
  enabled: true
  executable: "/root/homecloud/bin/HomeCloudMediaGateway-linux-amd64"
  working_dir: "/root/homecloud"
  config_path: "/root/homecloud/gateway-runtime.yaml"
  health_url: "http://127.0.0.1:8091/healthz"
  startup_timeout_seconds: 15
  shutdown_timeout_seconds: 10
  max_restarts: 3
  restart_backoff_seconds: 3
```

Back up the Backend config first and do not duplicate this block; YAML
duplicate keys may be rejected. Keep `server.host: "auto_private"`.
Gateway startup is supervised by the Backend; do **not** also launch a second
manual Gateway on 8091.

## 5. Restart / verify

Stop only the known existing HC SS and Backend processes gracefully, after
checking `ps` and `/proc/PID/exe`; avoid `pkill -f` or broad kills.
Start HCSS with the new binary and same JSON, then start Backend from its
project directory so its relative SQLite path stays consistent.

```bash
cd /root/homecloud/HomeCloudBackend
# (Only after controlled restart and backup of previous executables)
nohup /root/homecloud/bin/HomeCloudBackend-linux-amd64 serve \
  > /root/homecloud/backend.log 2>&1 &
echo $! >/root/homecloud/backend.pid

curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8091/healthz
curl -fsS http://127.0.0.1:8092/readyz
tail -n 35 /root/homecloud/backend.log
ss -lntp | grep -E ':(8080|8091|8092)\\b'
```

`8092` must remain loopback-only; `8080` and `8091` should expose the
necessary trusted LAN endpoint. Verify firewall isolation before testing.
If Gateway isn't registered, inspect both Backend and Gateway logs before
sending a media play request.

## 6. Trigger true media playback from Windows

TV must show **connected** to the Ubuntu Backend, not the Windows Backend.
In TV repo at commit containing `scripts/Dev-Play-HomeCloudMedia.ps1`:

```powershell
cd C:\Users\user\Python\hc_tv_player
.\scripts\Dev-Play-HomeCloudMedia.ps1 `
  -Backend "ws://100.114.58.74:8080/ws" `
  -BackendNodeId "hc-41364b51e0fcbd6be8e707634c5d7c46" `
  -TvDeviceId "THE-DEVICE-ID-SHOWN-BY-TV" `
  -StorageNodeId "c671fd9c-2338-44e5-b09f-23a62ca9656c" `
  -RootKind disk -RootId storage-hdd -FilePath "demo.mp4" `
  -Network lan -DryRun

# Remove -DryRun to send a real Backend command.
```

When TV is on a Tailscale network rather than LAN, use `-Network tailscale`
and make sure the Gateway registers that endpoint. A successful Backend
command confirms **acceptance**, not actual TV decoding. Check:

- Backend creates a room, TV and Gateway acknowledge offers.
- Gateway logs show a valid HCS1 source Stat and attachment.
- TV requests /media/session/{ticket-bound-token}; HTTP 206/200 bytes delivered.
- TV's actual decoder shows PLAYING (or audio), seek, pause and EOF.
- STOP closes the room and invalidates the Range URL.

**Do not call this complete if the Android TV decoder rejects the container,
if the local network blocks HTTP, or if media reports are missing.** The
demo audio test is separate: `Dev-Open-TVPlayer.ps1 -MediaKind audio`
checks the UI but not the real source transport.
