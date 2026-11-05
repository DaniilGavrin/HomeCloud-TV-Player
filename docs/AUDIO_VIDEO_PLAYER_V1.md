# HomeCloud TV Player — audio/video surface, stage 1

Audio and video use one HTMLVideoElement internally. This can play audio-only
media while rendering no picture. It preserves the KAN-52 Backend control
adapter (play/pause/volume) and decoder EOF reporting. The compact bottom
D-pad overlay is shared unchanged. Audio mode hides the video plane and shows
the local public/icon.png artwork, with no animated blur.

TVPlayerShell now accepts mediaKind = "audio" | "video" (default video),
and optionally sourceUrl. That URL is NOT derived from a TV-supplied command:
only a future Backend-authorized Gateway transport may supply a media source.
No arbitrary disk path, endpoint or TV client input should select a file.

The local video probe remains intact, but its test video cannot report real
room playback. Real decoder events use capturing document listeners so
late-mounted players report PLAYING / PAUSED / ENDED.

**This stage does NOT implement the remote media transport, HCM1 binary
receiver, MSE remux, FFmpeg, or trusted URL provider. It does not yet prove
real playback from Storage Service.** The room placeholder remains until
the authorized media pipeline has been connected.

Checks: npm ci && npm run build. Later physical-TV tests should cover
audio-only appearance, audio volume, pause, seek, EOF and real video.
