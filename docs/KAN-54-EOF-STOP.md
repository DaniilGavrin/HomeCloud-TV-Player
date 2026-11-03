# KAN-54 — TV fullscreen room lifecycle (without decoder)

TV subscribes to room events before requesting `media.rooms.snapshot`. An active room shows a minimal fullscreen lifecycle placeholder (not a fake decoder). `ENDED`/`IDLE` keeps it open, waiting for another file. A true future HTMLVideoElement `ended` event will report `TV ENDED` to Backend and free old media buffers while preserving room/control WebSockets.

`MediaStop` / Back / Escape or the on-screen Stop Viewing control sends `media.rooms.stop` with a unique `command_id`. It does not locally declare STOP complete. A version-fenced `media.room.closed` or authoritative empty snapshot removes the fullscreen state and reveals the existing waiting screen. Stale pre-STOP events and old-room closure messages cannot reopen/dismiss newer rooms.

The Rust Tauri command whitelist now permits TV-origin `media.rooms.stop`. **There is no actual media decoder or HCM1 data client here**; these are deferred to the source/codec integration phase.
