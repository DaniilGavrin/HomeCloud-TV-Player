# TV Player: parallel native bundles and D-pad timeline

## GitHub Actions

Single `.github/workflows/android-tv-release.yml` workflow on PR/main/manual runs:

- **Android**: unchanged signed universal APK and AAB in one native job, PR uses disposable signing, main uses existing private release keystore. Google Play versionCode continues to increase.
- **Windows**: one independent `windows-2022` runner per `nsis` and `msi` installer.
- **Linux**: three independent `ubuntu-24.04` runners for `deb`, `rpm`, `appimage`.
- `fail-fast: false` prevents failure of one format from canceling other formats.
- Each desktop runner verifies exactly one package and uploads its own artifact.
- On `main`, the existing Android release publishes signed APK/AAB first.
- A separate publishing job, dependent on successful desktop jobs **and** the Android release, uploads all desktop bundles plus `SHA256SUMS-desktop.txt` to the same commit-scoped release tag `tv-<SHA12>`. If a desktop bundle fails, the signed Android release still ships.
- On PR: build and verify packages only, never publish; the Android keystore is never exposed.

These are independent **jobs**, not Git branches. The workflow never tries to produce MSI on Linux.

## TV remote seeking

Native HTML5 `input type=range` was not accessible to D-pad focus in the target Android WebView. Replace it with a 44px focusable button carrying `role=slider` and `aria-valuenow`. The player stays the same:

1. When controls are hidden, press OK or any D-pad key to reveal them.
2. From the Play/Pause/±10s row press **Up** to focus the slider.
3. Press **Left/Right** to preview a destination. Repeated presses accelerate.
4. Press **OK** to commit once. **Back** cancels pending preview without closing the room.
5. A mouse click on the desktop slider still seeks to the corresponding position.
6. Converted HTTP fMP4 with `seek_supported=false` explicitly refuses seeking; the client cannot invent server-side seek.

No new Backend or Gateway command. No heavyweight animations or blur.
