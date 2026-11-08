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
import { stableDuration } from '../lib/playbackPolicy';
import { advanceSeekPreview, clampSeek } from '../lib/timelineNavigation';
import '../styles/tv-player-shell.css';

export interface TVPlayerShellProps {
  title: string;
  /** Derived from trusted Gateway content type; audio and video share controls. */
  mediaKind?: 'audio' | 'video';
  inspection?: MediaInspection;
  audioSelectionAvailable?: boolean;
  selectedAudioIndex?: number;
  seekSupported?: boolean;
  shouldAutoplay?: boolean;
  transportNotice?: string;
  onSelectAudioTrack?: (index:number)=>Promise<boolean>;
  /** Only supply a previously-authorized Gateway media URL; never from arbitrary TV commands. */
  sourceUrl?: string;
  roomId?: string;
  playbackId?: string;
  generation?: number;
  testMode?: boolean;
  onClose: () => void;
}

type FocusSlot = 'backward' | 'play' | 'forward' | 'timeline' | 'audio';
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

export function TVPlayerShell({ title, mediaKind = 'video', inspection, sourceUrl, roomId, playbackId,
 generation, audioSelectionAvailable = false, selectedAudioIndex, seekSupported = true,
 shouldAutoplay = true, transportNotice, onSelectAudioTrack, testMode = false, onClose }: TVPlayerShellProps) {
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const backwardRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const forwardRef = useRef<HTMLButtonElement>(null);
  const timelineRef = useRef<HTMLButtonElement>(null);
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
  const [audioMenuOpen,setAudioMenuOpen] = useState(false);
  const autoPlayAttemptRef=useRef('');
  // Native <input type="range"> is not reliably focusable on Android TV
  // WebView. Drive a semantic, focusable slider with the remote ourselves.
  const scrubRef=useRef<number|null>(null);
  const [scrubAt,setScrubAt]=useState<number|null>(null);
  const seekInfoRef=useRef({position:0,duration:0,canSeek:false});
  const inspectedMs=inspection?.media?.duration_ms;
  const hasInspectedDuration=typeof inspectedMs==='number' && Number.isFinite(inspectedMs) && inspectedMs>0;
  // A sequential converted fMP4 can report a growing decoder duration.
  // Never present that as total file length if ffprobe could not measure it.
  const displayedDuration=!seekSupported&&!hasInspectedDuration
    ?0:stableDuration(duration,inspectedMs);
  const displayedDurationLabel=!seekSupported&&!hasInspectedDuration
    ?'--:--':formatPlayerTime(displayedDuration);
  const canSeek = seekSupported && hasMedia && duration > 0 && Number.isFinite(duration);
  seekInfoRef.current={position,duration:displayedDuration,canSeek};
  const audioTracks=inspection?.status==='READY'
    ? inspection.media?.tracks.filter(t=>t.kind==='audio')??[] : [];

  const focus = useCallback((slot: FocusSlot) => {
    focusRef.current = slot;
    const controls: Record<FocusSlot, HTMLElement | null> = {
      backward: backwardRef.current, play: playRef.current,
      forward: forwardRef.current, timeline: timelineRef.current,
      audio: rootRef.current?.querySelector<HTMLButtonElement>('[data-hc-audio-track]') ?? null,
    };
    controls[slot]?.focus({ preventScroll: true });
  }, []);

  const hide = useCallback(() => {
    if(scrubRef.current!==null)return;
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    // Move focus OUT of the subsequently aria-hidden toolbar.
    rootRef.current?.focus({ preventScroll: true });
    visibleRef.current = false;
    setVisible(false);
  }, []);

  const keepOpen = useCallback(() => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = scrubRef.current===null ? setTimeout(hide, AUTO_HIDE_MS) : null;
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
    if (video.buffered.length) {
      try { setBuffered(video.buffered.end(video.buffered.length - 1)); }
      catch { setBuffered(0); }
    } else setBuffered(0);
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
    if (!seekSupported) {setNotice('Перемотка преобразованного потока пока недоступна');return;}
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
  }, [seekSupported]);

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    seekTo((video?.currentTime ?? 0) + seconds);
  }, [seekTo]);

  const cancelScrub = useCallback(() => {
    scrubRef.current=null;setScrubAt(null);
    keepOpen();
  },[keepOpen]);

  const stageScrub = useCallback((direction:-1|1,repeat:boolean) => {
    const snapshot=seekInfoRef.current;
    if(!snapshot.canSeek){
      setNotice('Перемотка этого потока недоступна');return;
    }
    const start=scrubRef.current??snapshot.position;
    const next=advanceSeekPreview(start,snapshot.duration,direction,repeat);
    scrubRef.current=next;setScrubAt(next);setNotice('');
    keepOpen();
  },[keepOpen]);

  const commitScrub = useCallback(() => {
    const snapshot=seekInfoRef.current;
    if(!snapshot.canSeek){
      setNotice('Перемотка этого потока недоступна');return;
    }
    if(scrubRef.current===null){
      scrubRef.current=clampSeek(snapshot.position,snapshot.duration);
      setScrubAt(scrubRef.current);
      keepOpen();
      return;
    }
    const target=scrubRef.current;
    scrubRef.current=null;setScrubAt(null);
    seekTo(target);
    keepOpen();
  },[seekTo,keepOpen]);

  const activate = useCallback((slot: FocusSlot) => {
    switch (slot) {
      case 'backward': seekBy(-SEEK_STEP); break;
      case 'play': void togglePlay(); break;
      case 'forward': seekBy(SEEK_STEP); break;
      case 'timeline': commitScrub(); break; // OK enters/commits preview.
    }
  }, [seekBy, togglePlay, commitScrub]);

  useEffect(() => {
    setNotice('');setAudioMenuOpen(false);autoPlayAttemptRef.current='';
    scrubRef.current=null;setScrubAt(null);
  },[sourceUrl]);
  const startAutomatically=useCallback(() => {
    const video=videoRef.current;
    if(!video || !sourceUrl || !shouldAutoplay || !video.paused || video.ended ||
       autoPlayAttemptRef.current===sourceUrl)return;
    autoPlayAttemptRef.current=sourceUrl;
    void video.play().then(()=>setNotice('')).catch(error=>{
      console.warn('TV auto playback failed',error);
      setNotice('Автоматическое воспроизведение недоступно — нажмите OK');
    });
  },[sourceUrl,shouldAutoplay]);

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
        if(scrubRef.current!==null){cancelScrub();focus('timeline');return}
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
      if (current === 'audio') {
        const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(
          '[data-hc-audio-track]') ?? []);
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if ((key === 'ArrowLeft' || key === 'ArrowRight') && buttons.length > 0) {
          const next = Math.max(0,Math.min(buttons.length-1,
            (currentIndex<0 ? 0 : currentIndex)+(key==='ArrowLeft' ? -1 : 1)));
          buttons[next]?.focus({preventScroll:true});
        } else if (key === 'ArrowUp') focus('timeline');
        else if (key === 'Enter' || key === ' ' || key === 'Spacebar')
          (document.activeElement as HTMLButtonElement)?.click();
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        if (current === 'timeline') {
          stageScrub(key === 'ArrowLeft' ? -1 : 1,event.repeat);
        } else {
          const row: FocusSlot[] = ['backward', 'play', 'forward'];
          const idx = row.indexOf(current);
          const newIdx = idx < 0 ? 1 : Math.max(0, Math.min(2, idx + (key === 'ArrowLeft' ? -1 : 1)));
          focus(row[newIdx]);
        }
      } else if (key === 'ArrowDown') {
        if(current==='timeline'){if(scrubRef.current!==null)cancelScrub();focus('play')}
      } else if (key === 'ArrowUp') {
        // The timeline is directly above the transport buttons on a TV.
        focus('timeline');
      } else {
        activate(current);
      }
    };
    // Capture native D-pad before other media handlers (including MediaControlBridge).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activate, cancelScrub, focus, hide, keepOpen, onClose, seekBy, show, stageScrub, togglePlay]);

  const previewPosition=scrubAt??position;
  const progress = displayedDuration > 0 ? Math.min(100,Math.max(0,previewPosition/displayedDuration*100)) : 0;
  const loaded = displayedDuration > 0 ? Math.min(100,Math.max(0,buffered/displayedDuration*100)) : 0;
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
        autoPlay={testMode || (Boolean(sourceUrl) && shouldAutoplay)}
        muted={testMode && mediaKind === 'video'}
        playsInline
        aria-label={mediaKind === 'audio' ? 'Аудиоплеер HomeCloud' : 'Видеоплеер HomeCloud'}
        onLoadedMetadata={() => {updateFromVideo();startAutomatically();}}
        onCanPlay={startAutomatically}
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

          </div>

          <div className="hc-tv-player__timeline-row">
            <span className="hc-tv-player__time">{formatPlayerTime(position)}</span>
            <button
              ref={timelineRef}
              type="button"
              role="slider"
              aria-label="Позиция воспроизведения. Стрелки влево и вправо выбирают время, OK подтверждает"
              aria-valuemin={0}
              aria-valuemax={Math.max(1,Math.round(displayedDuration))}
              aria-valuenow={Math.min(Math.round(previewPosition),Math.max(1,Math.round(displayedDuration)))}
              aria-valuetext={`${formatPlayerTime(previewPosition)} из ${displayedDurationLabel}`}
              aria-disabled={!canSeek}
              tabIndex={visible ? 0 : -1}
              className={`hc-tv-player__timeline${scrubAt!==null?' hc-tv-player__timeline--scrubbing':''}`}
              style={timelineStyle}
              onFocus={() => {focusRef.current='timeline';keepOpen();}}
              onBlur={() => {if(scrubRef.current!==null)cancelScrub();}}
              onClick={event => {
                // D-pad/Enter is handled in the capture keydown listener.
                if(event.detail===0)return;
                if(!canSeek){setNotice('Перемотка этого потока недоступна');return;}
                const rect=event.currentTarget.getBoundingClientRect();
                seekTo(clampSeek((event.clientX-rect.left)/rect.width*displayedDuration,displayedDuration));
                cancelScrub();keepOpen();
              }}
            >
              <span className="hc-tv-player__timeline-track" aria-hidden="true"/>
              <span className="hc-tv-player__timeline-thumb" aria-hidden="true"/>
              {scrubAt!==null&&<span className="hc-tv-player__timeline-preview" aria-hidden="true">
                {formatPlayerTime(scrubAt)} · OK
              </span>}
            </button>
            <span className="hc-tv-player__time">{displayedDurationLabel}</span>
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
            <div className="hc-tv-player__right-actions">
              {audioSelectionAvailable && audioTracks.length > 0 && (
                <button type="button" className="hc-tv-player__audio-toggle"
                  aria-label="Настройки звука" aria-expanded={audioMenuOpen}
                  onClick={() => {setAudioMenuOpen(v=>!v);keepOpen();}}>Звук</button>
              )}
              <span className="hc-tv-player__watermark">HomeCloud TV</span>
            </div>
          </div>
          {audioMenuOpen && audioSelectionAvailable && audioTracks.length > 0 && (
            <div className="hc-tv-player__audio-tracks" aria-label="Выбор аудиодорожки">
              {audioTracks.slice(0,8).map(track => (
                <button key={track.index} type="button" data-hc-audio-track
                  className="hc-tv-player__audio-track" tabIndex={visible ? 0 : -1}
                  aria-pressed={selectedAudioIndex===track.index}
                  onFocus={() => {focusRef.current='audio';keepOpen();}}
                  onClick={() => {
                    keepOpen();setAudioMenuOpen(false);
                    void onSelectAudioTrack?.(track.index).then(ok=>{
                      if(!ok)setNotice('Не удалось переключить аудиодорожку');
                    }).catch(()=>setNotice('Не удалось переключить звук'));
                  }}>
                  {track.language?.toUpperCase() || ('Дорожка ' + (track.index+1))}
                  {selectedAudioIndex===track.index?' ✓':''}
                </button>
              ))}
            </div>
          )}
          {(notice || transportNotice || !hasMedia) && (
            <div className="hc-tv-player__notice" role="status">
              {notice || transportNotice || 'Ожидание медиаисточника'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
