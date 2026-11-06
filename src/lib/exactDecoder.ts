/** KAN-61 second-stage decoder check for the *specific inspected file*.
 * MediaCapabilities is only an estimate: the actual HTMLVideoElement decides
 * final playback success. Absence of the API must never imply compatibility.
 */
import type { MediaInspection, MediaTrack } from './mediaStream';
import type { DecoderCapabilities } from './mediaCapabilities';

function avcCodec(t: MediaTrack): string | null {
  if (t.codec !== 'h264' || !t.level || t.level < 10 || t.level > 62) return null;
  const p = t.profile?.toLowerCase() ?? '';
  // Never treat High 10/High 4:2:2 as ordinary 8-bit High.
  const profile = p === 'high' ? '6400' :
    p === 'main' ? '4d40' :
    p === 'constrained baseline' ? '42e0' :
    p === 'baseline' ? '4200' : '';
  if (!profile) return null;
  return 'avc1.' + profile + t.level.toString(16).padStart(2, '0').toUpperCase();
}
function hevcCodec(t: MediaTrack): string | null {
  if (t.codec !== 'hevc' || !t.level || t.level <= 0) return null;
  const p = t.profile?.toLowerCase();
  if (p === 'main') return `hvc1.1.6.L${t.level}.B0`;
  if (p === 'main 10') return `hvc1.2.4.L${t.level}.B0`;
  return null;
}
function videoMime(container: string, t: MediaTrack): string | null {
  const mime: Record<string, string> = {
    mp4: 'video/mp4', webm: 'video/webm', matroska: 'video/x-matroska',
  };
  const codec = avcCodec(t) ?? hevcCodec(t);
  if (!mime[container] || !codec) return null;
  return `${mime[container]}; codecs="${codec}"`;
}
function audioMime(container: string, t: MediaTrack): string | null {
  if (t.codec === 'aac') return 'audio/mp4; codecs="mp4a.40.2"';
  if (t.codec === 'mp3') return 'audio/mpeg';
  if (t.codec === 'opus') return 'audio/webm; codecs="opus"';
  if (t.codec === 'flac') return 'audio/flac';
  if (container === 'wav' && t.codec === 'pcm_s16le') return 'audio/wav; codecs="1"';
  return null;
}
function frameRate(raw?: string): number {
  if (!raw) return 0;
  const [a, b] = raw.split('/');
  const n = Number(a), d = b ? Number(b) : 1;
  return Number.isFinite(n / d) && n / d > 0 && n / d <= 240 ? n / d : 0;
}

export async function inspectExactDecoder(
  report: MediaInspection,
  decodingInfo?: (config: MediaDecodingConfiguration) => Promise<MediaCapabilitiesDecodingInfo>,
): Promise<DecoderCapabilities | null> {
  const media = report.media;
  if (!media || !decodingInfo || !Array.isArray(media.tracks)) return null;
  const video = media.tracks.find(t => t.kind === 'video');
  const selected = report.decision?.audio_stream_index;
  const audio = media.tracks.find(t => t.kind === 'audio' && t.index === selected) ??
    media.tracks.find(t => t.kind === 'audio' && t.default) ??
    media.tracks.find(t => t.kind === 'audio');
  const formats: NonNullable<DecoderCapabilities['formats']> = [];
  const config: MediaDecodingConfiguration = { type: 'file' };

  if (video) {
    const mime = videoMime(media.container, video);
    const width = video.width ?? 0, height = video.height ?? 0;
    const bitrate = video.bit_rate ?? media.bit_rate ?? 0;
    const fps = frameRate(video.frame_rate);
    if (!mime || width <= 0 || height <= 0 || bitrate <= 0 || fps <= 0 ||
        !video.profile || !video.level) return null;
    config.video = { contentType: mime, width, height, bitrate, framerate: fps };
  }
  if (audio) {
    const mime = audioMime(media.container, audio);
    const bitrate = audio.bit_rate ?? 0;
    const samplerate = audio.sample_rate ?? 0;
    const channels = audio.channels ?? 0;
    if (!mime || bitrate <= 0 || samplerate <= 0 || channels <= 0) return null;
    config.audio = {
      contentType: mime, bitrate, samplerate,
      channels: channels.toString(),
    };
  }
  if (!video && !audio) return null;
  try {
    const result = await decodingInfo(config);
    const support = result.supported && result.smooth ? 'probably' :
      result.supported ? 'maybe' : 'unsupported';
    formats.push({
      container: media.container,
      ...(video ? { video_codec: video.codec, video_profiles: [video.profile!],
        max_level: video.level!, max_width: video.width!, max_height: video.height! } : {}),
      ...(audio ? { audio_codec: audio.codec } : {}),
      certainty: support,
    });
    return { version: 1, source: 'media_capabilities_api', formats };
  } catch {
    return null;
  }
}

export async function currentExactDecoder(
  report: MediaInspection,
): Promise<DecoderCapabilities | null> {
  try {
    const api = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : undefined;
    if (!api || typeof api.decodingInfo !== 'function') return null;
    return inspectExactDecoder(report, config => api.decodingInfo(config));
  } catch {
    return null;
  }
}
