# HomeCloud TV Player — unified audio and video playback (CAT stage)

## Design

HomeCloud TV Player plays both video and audio. It keeps the existing compact
bottom D-pad transport bar (play/pause, seek +/-10s, timeline and status).
Audio is deliberately **without a video picture**: the HTMLVideoElement is
used as the media engine, but its video surface is hidden when `media_kind`
is `audio`. This preserves controls and HTMLMediaElement `ended` reporting
without duplicating the player or adding a separate Android TV app.

The old dev command is retained. The audio test mode generates an isolated
8-second PCM/WAV tone, not a network stream:

    .\scripts\Dev-Open-TVPlayer.ps1 -MediaKind audio

The temporary test player does NOT report fake room decoder states.

## End-to-end source attachment

1. UI issues Backend `media.rooms.play` using `storage_node_id` and
   `file_id` supplied by the Storage Service's `storage.fs.list/stat`.
2. Backend sends its authorized room offer containing `gateway_ws_url`,
   a one-use attachment ticket, `room_id/playback_id/generation`, and target.
3. The target TV opens a direct Gateway WS with
   `capabilities:{"http_range":true}`, consuming that ticket.
4. Gateway checks the ticket against its room grant and offers
   `http_media_path` (64 hex chars), `media_kind` (audio/video) and
   `content_type`. HTTP Range access is bound to the same TV source IP and
   revoked when the direct socket/room closes.
5. TV Player constructs an HTTP(S) URL on the SAME authorized private
   Gateway origin. An actual HTMLVideoElement uses that URL; the Android
   WebView's native decoder handles media containers/codecs it supports.
6. Decoder `playing/pause/ended` events, not merely a successful HTTP or
   WS handshake, are reported through Backend control WS.
7. A Backend restart or missed initial offer may request a fresh
   `media.room.ticket`; up to 3 bounded retries cover races while Gateway
   is preparing HC SS metadata.

The HCS1 and HCM1 binary transports remain in Gateway. HTTP Range is the
decoder-compatible alternative to feeding opaque MP4 chunks into WebView.
No media bytes pass through the central Backend.

## Requirements and scope

- HC SS main must have HCS1 source WS enabled, approved storage roots and
  exact allowed Gateway IP.
- Gateway main must configure `storage.source_nodes` with the matching
  storage node ID + private WS endpoint. The Gateway HTTP source is offered
  only after a trusted Backend room ticket has been consumed.
- Build this TV branch's APK/AAB and install on a real Android TV to test.
  Do not distribute the unfinished integration as a production update yet.
- First test with widely supported MP4/H.264/AAC for video and MP3 or M4A/AAC
  for audio. Codec capabilities vary by Android TV hardware and WebView.
  MKV/FLAC/AV1 and other inputs may need FFmpeg remux/transcoding.
- Seek through HTMLMediaElement uses HTTP byte ranges. Full Backend
  seek-position synchronization and keyframe-aligned transcoding remain
  independent acceptance items.
- Without cryptographic component authentication, HCS1 access must stay
  limited to a trusted private network; HTTP Range links are ephemeral
  bearer capabilities. Never expose the Gateway source port publicly.

## Smoke test

From the local TV Player repo, with both services running and an identified
TV already connected to Backend:

    .\scripts\Dev-Play-HCSS-TV.ps1 -Backend 'ws://127.0.0.1:8080/ws' `
      -TargetNodeId '<backend-node-id>' -StorageNodeId '<hc-ss-node-id>' `
      -FileId '<file_id-from-storage.fs.list>' -Network lan

Optionally set `-TvDeviceId` if more than one TV is connected.

The script's `ACCEPTED` or `DELIVERED` status is only Backend control-plane
delivery, not proof of playback. On device verify actual video/audio output,
D-pad, pause, seek, EOF, STOP, reconnection and Android WebView codec support.

CI checks TypeScript/Vite build and signed Android APK/AAB workflows. CI is not
a substitute for physical-TV media decoding tests.
