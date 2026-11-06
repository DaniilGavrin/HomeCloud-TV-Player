/** KAN-61 capability declaration for the *actual* HTMLMediaElement used by TV.
 * canPlayType("probably") is a browser estimate, NOT proof of hardware
 * accelerated decode, max level/resolution, or that a whole MKV will play.
 * Unknown limits intentionally remain zero and must never produce DIRECT.
 */
export type FormatSupport = {
  container: string;
  video_codec?: string;
  audio_codec?: string;
  video_profiles?: string[];
  max_level?: number;
  max_width?: number;
  max_height?: number;
  certainty: 'probably' | 'maybe' | 'unsupported';
};

export type DecoderCapabilities = {
  version: 1;
  source: 'webview_can_play_type' | 'unavailable';
  formats: FormatSupport[];
  preferred_audio_language?: string;
  requested_audio_index?: number;
};

type Trial = {
  container: string;
  videoCodec?: string;
  audioCodec?: string;
  mime: string;
};

const trials: Trial[] = [
  { container: 'mp3', audioCodec: 'mp3', mime: 'audio/mpeg' },
  { container: 'flac', audioCodec: 'flac', mime: 'audio/flac' },
  { container: 'wav', audioCodec: 'pcm_s16le', mime: 'audio/wav; codecs="1"' },
  { container: 'mp4', audioCodec: 'aac', mime: 'audio/mp4; codecs="mp4a.40.2"' },
  { container: 'ogg', audioCodec: 'opus', mime: 'audio/ogg; codecs="opus"' },
  { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
  { container: 'mp4', videoCodec: 'hevc', audioCodec: 'aac', mime: 'video/mp4; codecs="hvc1.1.6.L120.B0, mp4a.40.2"' },
  { container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', mime: 'video/webm; codecs="vp9, opus"' },
  { container: 'matroska', videoCodec: 'h264', audioCodec: 'aac', mime: 'video/x-matroska; codecs="avc1.640028, mp4a.40.2"' },
  { container: 'matroska', videoCodec: 'hevc', audioCodec: 'aac', mime: 'video/x-matroska; codecs="hvc1.1.6.L120.B0, mp4a.40.2"' },
  { container: 'matroska', videoCodec: 'hevc', audioCodec: 'dts', mime: 'video/x-matroska; codecs="hvc1.1.6.L120.B0, dts"' },
];

const langToISO3: Record<string, string> = {
  ru: 'rus', en: 'eng', uk: 'ukr', de: 'deu', fr: 'fra',
  es: 'spa', it: 'ita', pl: 'pol', sr: 'srp',
};

export function detectDecoderCapabilities(
  canPlayType?: (mime: string) => string,
  language?: string,
): DecoderCapabilities {
  const declared: DecoderCapabilities = {
    version: 1,
    source: canPlayType ? 'webview_can_play_type' : 'unavailable',
    formats: [],
  };
  const iso = langToISO3[language?.slice(0, 2).toLowerCase() ?? ''];
  if (iso) declared.preferred_audio_language = iso;
  if (!canPlayType) return declared;
  for (const t of trials) {
    let grade = '';
    try { grade = canPlayType(t.mime); } catch { /* unsupported WebView */ }
    declared.formats.push({
      container: t.container, ...(t.videoCodec ? { video_codec: t.videoCodec } : {}),
      ...(t.audioCodec ? { audio_codec: t.audioCodec } : {}),
      certainty: grade === 'probably' ? 'probably' : grade === 'maybe' ? 'maybe' : 'unsupported',
    });
  }
  return declared;
}

/** Collect only from the real WebView, never from a hardcoded TV whitelist. */
export function currentDecoderCapabilities(): DecoderCapabilities {
  try {
    if (typeof document === 'undefined') return detectDecoderCapabilities();
    const element = document.createElement('video');
    if (typeof element.canPlayType !== 'function') return detectDecoderCapabilities();
    return detectDecoderCapabilities(
      mime => element.canPlayType(mime),
      typeof navigator !== 'undefined' ? navigator.language : undefined,
    );
  } catch {
    return detectDecoderCapabilities();
  }
}
