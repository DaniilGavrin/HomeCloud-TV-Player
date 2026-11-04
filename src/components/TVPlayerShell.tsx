/**
 * Real fullscreen HTMLVideoElement player surface. The temporary WS probe can
 * open it before Media Gateway supplies video bytes. Do not synthesize frames,
 * room state or playback readiness when there is no source.
 *
 * Keep this component when removing the temporary KAN-74 test command.
 */
import '../styles/tv-player-shell.css';

export interface TVPlayerShellProps {
  title: string;
  testMode?: boolean;
  onClose: () => void;
}

export function TVPlayerShell({ title, testMode = false, onClose }: TVPlayerShellProps) {
  return (
    <section className="hc-tv-player" role="dialog" aria-modal="true" aria-label="HomeCloud TV Player">
      <video className="hc-tv-player__video" data-homecloud-media preload="none" playsInline aria-label="Видеоплеер HomeCloud" />
      <div className="hc-tv-player__background" aria-hidden="true" />
      <div className="hc-tv-player__top">
        <span className="hc-tv-player__brand">HomeCloud <strong>TV Player</strong></span>
        {testMode && <span className="hc-tv-player__mode">WS · TEST MODE</span>}
      </div>
      <div className="hc-tv-player__center" role="status">
        <div className="hc-tv-player__play-glyph" aria-hidden="true">▶</div>
        <h1>{title}</h1>
        <p>{testMode ? 'Экран плеера открыт командой HomeCloudBackend.' : 'Ожидание источника медиа'}</p>
        <p className="hc-tv-player__note">Медиапоток не подключён · воспроизведение не запущено</p>
      </div>
      <div className="hc-tv-player__bottom">
        <div className="hc-tv-player__timeline" aria-hidden="true"><span /></div>
        <div className="hc-tv-player__footer">
          <span>00:00 / --:--</span>
          <button type="button" className="hc-tv-player__close" onClick={onClose} autoFocus>
            {testMode ? 'Закрыть тестовый плеер' : 'Назад'}
          </button>
        </div>
      </div>
    </section>
  );
}
