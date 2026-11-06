/**
 * HomeCloud TV player surface and D-pad transport controls (KAN-75).
 *
 * - Small bottom-only overlay: shown initially, auto-hidden in 3.5s.
 * - OK / D-pad reveals controls again with Play/Pause focused.
 * - Previous/next are intentionally NOT a media queue: they seek -/+10s.
 * - One HTMLVideoElement plays BOTH video and audio-only media with the same
 *   remote/D-pad controls. Audio mode hides the picture entirely.
 * - A real media element supplies timeline, duration, playback and seekability.
 * - In temporary KAN-74 testMode only, a packaged local video exercises the
 *   real decoder and controls without claiming a Media Gateway stream.
 *
 * This shell is reusable. Remove only DevPlayerProbe and the local demo file
 * after Media Gateway provides an actual source URL/decoder.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MediaInspection } from '../lib/mediaStream';
import '../styles/tv-player-shell.css';

export interface TVPlayerShellProps {
  title: string;
  /** Derived from trusted Gateway content type; audio and video share controls. */
  mediaKind?: 'audio' | 'video';
  inspection?: MediaInspection;
  /** Only supply a previously-authorized Gateway media URL; never from arbitrary TV commands. */
  sourceUrl?: string;
  roomId?: string;
  playbackId?: string;
  generation?: number;
  testMode?: boolean;
  onClose: () => void;
}

type FocusSlot = 'backward' | 'play' | 'forward' | 'timeline';
const AUTO_HIDE_MS = 3500;
const SEEK_STEP = 10;

export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const t = Math.floor(seconds);
  const hours = Math.floor(t / 3600);
  const minutes = Math.floor((t % 3600) / 60);
  const secs = String(t % 60).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secs}`;
  return `${String(minutes).padStart(2, '0')}:${secs}`;
}

function normalizedKey(event: KeyboardEvent): string {
  // Some Android WebViews report native D-pad codes as 'Unidentified'.
  const androidKeys: Record<number, string> = {
    4: 'Escape', 19: 'ArrowUp', 20: 'ArrowDown', 21: 'ArrowLeft',
    22: 'ArrowRight', 23: 'Enter', 66: 'Enter', 85: 'MediaPlayPause',
    89: 'MediaRewind', 90: 'MediaFastForward',
  };
  if (!event.key || event.key === 'Unidentified') return androidKeys[event.keyCode] ?? '';
  return event.key;
}

export function TVPlayerShell({ title, mediaKind = 'video', inspection, sourceUrl, roomId, playbackId, generation, testMode = false, onClose }: TVPlayerShellProps) {
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const backwardRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const forwardRef = useRef<HTMLButtonElement>(null);
  const timelineRef = useRef<HTMLInputElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(true);
  const focusRef = useRef<FocusSlot>('play');
  const [visible, setVisible] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [hasMedia, setHasMedia] = useState(false);
  const [notice, setNotice] = useState('');

  const focus = useCallback((slot: FocusSlot) => {
    focusRef.current = slot;
    const controls: Record<FocusSlot, HTMLElement | null> = {
      backward: backwardRef.current, play: playRef.current,
      forward: forwardRef.current, timeline: timelineRef.current,
    };
    controls[slot]?.focus({ preventScroll: true });
  }, []);

  const hide = useCallback(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    // Move focus OUT of the subsequently aria-hidden toolbar.
    rootRef.current?.focus({ preventScroll: true });
    visibleRef.current = false;
    setVisible(false);
  }, []);

  const keepOpen = useCallback(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(hide, AUTO_HIDE_MS);
  }, [hide]);

  const show = useCallback((slot: FocusSlot = 'play') => {
    visibleRef.current = true;
    setVisible(true);
    // Focus after React has removed the toolbar's inert state.
    requestAnimationFrame(() => focus(slot));
    keepOpen();
  }, [focus, keepOpen]);

  const updateFromVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const valid = Number.isFinite(video.duration) && video.duration > 0;
    setDuration(valid ? video.duration : 0);
    setPosition(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    setPlaying(!video.paused && !video.ended);
    setHasMedia(video.readyState > HTMLMediaElement.HAVE_NOTHING);
    if (video.buffered.length && valid) {
      try { setBuffered(Math.min(video.duration, video.buffered.end(video.buffered.length - 1))); }
      catch { setBuffered(0); }
    }
  }, []);

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState === HTMLMediaElement.HAVE_NOTHING) {
      setNotice('Медиаисточник ещё не загружен');
      return;
    }
    try {
      if (video.paused || video.ended) await video.play();
      else video.pause();
      setNotice('');
      updateFromVideo();
    } catch (error) {
      console.error('Video play/pause failed', error);
      setNotice('Телевизор не смог начать воспроизведение');
    }
  }, [updateFromVideo]);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || video.readyState === HTMLMediaElement.HAVE_NOTHING ||
        !Number.isFinite(video.duration) || video.duration <= 0) {
      setNotice('Перемотка доступна после загрузки медиафайла');
      return;
    }
    const next = Math.min(Math.max(0, seconds), video.duration);
    try {
      video.currentTime = next;
      setPosition(next);
      setNotice('');
    } catch (error) {
      console.error('Video seek failed', error);
      setNotice('Не удалось перемотать этот источник');
    }
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    seekTo((video?.currentTime ?? 0) + seconds);
  }, [seekTo]);

  const activate = useCallback((slot: FocusSlot) => {
    switch (slot) {
      case 'backward': seekBy(-SEEK_STEP); break;
      case 'play': void togglePlay(); break;
      case 'forward': seekBy(SEEK_STEP); break;
      case 'timeline': break; // D-pad arrows move timeline, OK does not restart media.
    }
  }, [seekBy, togglePlay]);

  useEffect(() => {
    show('play');
    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    };
  }, [show]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = normalizedKey(event);
      const isBack = ['Escape', 'Backspace', 'BrowserBack', 'GoBack', 'MediaStop'].includes(key);
      const isDpad = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'Spacebar'].includes(key);
      const isMedia = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaRewind', 'MediaFastForward'].includes(key);
      if (!isBack && !isDpad && !isMedia) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat && ['Enter', ' ', 'Spacebar', 'MediaPlayPause'].includes(key)) return;
      if (isBack) {
        if (visibleRef.current) hide();
        else onClose();
        return;
      }
      if (isMedia) {
        show('play');
        if (key === 'MediaRewind') seekBy(-SEEK_STEP);
        else if (key === 'MediaFastForward') seekBy(SEEK_STEP);
        else if (key === 'MediaPlayPause') void togglePlay();
        else if (key === 'MediaPlay' && videoRef.current?.paused) void togglePlay();
        else if (key === 'MediaPause' && videoRef.current && !videoRef.current.paused) void togglePlay();
        return;
      }
      // First D-pad press just reveals the controls, never accidentally seeks.
      if (!visibleRef.current) {
        show('play');
        return;
      }
      keepOpen();
      const current = focusRef.current;
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        if (current === 'timeline') {
          seekBy(key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP);
        } else {
          const row: FocusSlot[] = ['backward', 'play', 'forward'];
          const idx = row.indexOf(current);
          const newIdx = idx < 0 ? 1 : Math.max(0, Math.min(2, idx + (key === 'ArrowLeft' ? -1 : 1)));
          focus(row[newIdx]);
        }
      } else if (key === 'ArrowDown') {
        focus('timeline');
      } else if (key === 'ArrowUp') {
        focus('play');
      } else {
        activate(current);
      }
    };
    // Capture native D-pad before other media handlers (including MediaControlBridge).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activate, focus, hide, keepOpen, onClose, seekBy, show, togglePlay]);

  const canSeek = hasMedia && duration > 0 && Number.isFinite(duration);
  const progress = canSeek ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  const loaded = canSeek ? Math.min(100, Math.max(0, buffered / duration * 100)) : 0;
  const timelineStyle = { '--hc-progress': `${progress}%`, '--hc-buffered': `${loaded}%` } as CSSProperties;

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      className="hc-tv-player"
      role="dialog"
      aria-modal="true"
      aria-label="HomeCloud TV Player"
      onPointerMove={() => { if (!visibleRef.current) show(); else keepOpen(); }}
    >
      <video
        ref={videoRef}
        className={`hc-tv-player__video${mediaKind === 'audio' ? ' hc-tv-player__video--audio' : ''}`}
        data-homecloud-media={testMode ? undefined : ''}
        data-room-id={testMode ? undefined : roomId}
        data-playback-id={testMode ? undefined : playbackId}
        data-generation={testMode ? undefined : generation}
        src={sourceUrl ?? (testMode && mediaKind === 'video' ? '/hc-tv-control-test.mp4' : undefined)}
        preload={testMode || sourceUrl ? 'auto' : 'none'}
        autoPlay={testMode || Boolean(sourceUrl)}
        muted={testMode && mediaKind === 'video'}
        playsInline
        aria-label={mediaKind === 'audio' ? 'Аудиоплеер HomeCloud' : 'Видеоплеер HomeCloud'}
        onLoadedMetadata={updateFromVideo}
        onDurationChange={updateFromVideo}
        onTimeUpdate={updateFromVideo}
        onProgress={updateFromVideo}
        onPlay={updateFromVideo}
        onPause={updateFromVideo}
        onEnded={updateFromVideo}
        onError={() => setNotice('Не удалось загрузить медиафайл')}
      />
      <div className="hc-tv-player__background" aria-hidden="true" />
      {/* A small bottom overlay: no central UI and no full-screen blur. */}
      <div
        className={`hc-tv-player__hud${visible ? ' hc-tv-player__hud--visible' : ''}`}
        aria-hidden={!visible}
      >
        <div className="hc-tv-player__hud-inner">
          <div className="hc-tv-player__heading">
            <span className="hc-tv-player__title" title={title}>{title}</span>
            {testMode && <span className="hc-tv-player__mode">TEST</span>}
            {inspection?.status === 'READY' && inspection.media && (
              <span className="hc-tv-player__mode" title="Метаданные источника (ffprobe)">
                {inspection.media.container.toUpperCase()}
                {' · '}{inspection.media.tracks.find(t => t.kind === 'video')?.codec?.toUpperCase() ??
                  inspection.media.tracks.find(t => t.kind === 'audio')?.codec?.toUpperCase() ?? ''}
              </span>
            )}
          </div>

          <div className="hc-tv-player__timeline-row">
            <span className="hc-tv-player__time">{formatPlayerTime(position)}</span>
            <input
              ref={timelineRef}
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.25}
              value={Math.min(position, duration > 0 ? duration : 1)}
              aria-label="Перемотка по таймлайну"
              aria-valuetext={`${formatPlayerTime(position)} из ${formatPlayerTime(duration)}`}
              aria-disabled={!canSeek}
              tabIndex={visible ? 0 : -1}
              className="hc-tv-player__timeline"
              style={timelineStyle}
              onFocus={() => { focusRef.current = 'timeline'; keepOpen(); }}
              onChange={event => { seekTo(Number(event.currentTarget.value)); keepOpen(); }}
            />
            <span className="hc-tv-player__time">{formatPlayerTime(duration)}</span>
          </div>

          <div className="hc-tv-player__control-row" aria-label="Управление воспроизведением">
            <div className="hc-tv-player__transport">
              <button
                ref={backwardRef} type="button" tabIndex={visible ? 0 : -1}
                className="hc-tv-player__control" aria-label="Назад на 10 секунд"
                onFocus={() => { focusRef.current = 'backward'; keepOpen(); }}
                onClick={() => { seekBy(-SEEK_STEP); show('backward'); }}
              >
                <svg viewBox="0 0 28 28" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6.5 11a8.5 8.5 0 1 1-.2 7" /><path d="M6.5 4.7V11H13" />
                </svg>
                <span className="hc-tv-player__seek-label">10</span>
              </button>
              <button
                ref={playRef} type="button" tabIndex={visible ? 0 : -1}
                className="hc-tv-player__control hc-tv-player__control--play"
                aria-label={playing ? 'Пауза' : 'Воспроизвести'}
                onFocus={() => { focusRef.current = 'play'; keepOpen(); }}
                onClick={() => { void togglePlay(); show('play'); }}
              >
                {playing ? (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M7 4.5a1 1 0 0 1 1.53-.85l12 7.5a1 1 0 0 1 0 1.7l-12 7.5A1 1 0 0 1 7 19.5z"/></svg>
                )}
              </button>
              <button
                ref={forwardRef} type="button" tabIndex={visible ? 0 : -1}
                className="hc-tv-player__control" aria-label="Вперёд на 10 секунд"
                onFocus={() => { focusRef.current = 'forward'; keepOpen(); }}
                onClick={() => { seekBy(SEEK_STEP); show('forward'); }}
              >
                <svg viewBox="0 0 28 28" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21.5 11a8.5 8.5 0 1 0 .2 7" /><path d="M21.5 4.7V11H15" />
                </svg>
                <span className="hc-tv-player__seek-label">10</span>
              </button>
            </div>
            <span className="hc-tv-player__watermark">HomeCloud TV</span>
          </div>
          {inspection?.status === 'READY' && (
            <div className="hc-tv-player__inspection" aria-label="Медиаинспекция">
              <span>Режим (оценка): {inspection.decision?.mode ?? 'UNKNOWN'}
                {' · '}{inspection.decision?.reason ?? 'Не определён'}</span>
              {inspection.media?.tracks.some(t => t.kind === 'audio') && (
                <span>
                  Аудиодорожки: {inspection.media.tracks.filter(t => t.kind === 'audio')
                    .slice(0, 4).map(t =>
                      `#${t.index} ${t.codec.toUpperCase()} ${t.language ?? ''}` +
                      (t.index === inspection.decision?.audio_stream_index ? ' (предпочт.)' : '')
                    ).join(' · ')}
                </span>
              )}
            </div>
          )}
          {(notice || !hasMedia) && (
            <div className="hc-tv-player__notice" role="status">
              {notice || 'Ожидание медиаисточника'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
