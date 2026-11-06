# KAN-55 — Switching media within an active room

The dev PowerShell controller can create a new playback session or replace media within an existing HomeCloud room. It never streams file bytes itself.

## How to use

1. Discover the desired `file_id` by running `scripts/Dev-Play-Storage.ps1` without `-Play`.
2. Start a first file with `-Play -FileId <file-id> -NodeId <backend-node-id>`. Keep the returned `room_id`.
3. To switch from audio to video (or between videos), run the same command with another `-FileId` **and** `-RoomId <existing-room-id>`.
4. For a new room after a confirmed STOP, omit `-RoomId`.

Example (replace placeholders with IDs returned by Backend):

```powershell
.\scripts\Dev-Play-Storage.ps1 `
  -Backend 'ws://192.168.0.147:8080/ws' `
  -StorageNodeId '<storage-node-id>' `
  -NodeId '<backend-node-id>' `
  -RootID 'storage-hdd' `
  -Path 'hc-test' `
  -FileId '<next-file-id>' `
  -RoomId '<existing-room-id>' `
  -Network lan `
  -Play
```

`media.rooms.play` without `room_id` **creates** a room and returns `ROOM_CONFLICT` if that TV already belongs to another active room. With `room_id`, Backend reuses the room and allocates a new `playback_id`/`generation`. The existing Gateway/TV still need to handle replacement correctly; command acceptance does not prove decoder success.

The controller deliberately does **not** auto-select an occupied room. A user must provide the exact `room_id` to avoid replacing another controller's playback accidentally.

## Acceptance matrix

- [ ] Replace playing MP3 with MKV using the same `room_id`.
- [ ] Switch during playback and after decoder EOF.
- [ ] Old media frames and reports do not appear in the new playback.
- [ ] TV stays in its full-screen room, and Gateway/TV data connection is maintained as intended by KAN-55.
- [ ] A different room or TV cannot be hijacked by the controller.
- [ ] Full STOP closes the room; next PLAY without `room_id` opens a new one.

The first physical MP3-to-MKV test was reported successful on 2026-11-05, but it was not a complete automated acceptance suite. Protocol ownership: HomeCloudBackend `internal/mediarooms/manager.go`; related Jira issue: KAN-55.
