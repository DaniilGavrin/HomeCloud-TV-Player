/** KAN-59 HTTP media attachment.
 * A direct WebSocket consumes the Backend-issued one-time TV ticket. The
 * Gateway replies with a short-lived, room/peer-bound HTTP Range URL for
 * WebView's native audio/video decoder. Never accept media URLs from panels.
 */
import type { RoomLifecycle } from './roomLifecycle';
import { currentDecoderCapabilities } from './mediaCapabilities.ts';
import { currentExactDecoder } from './exactDecoder.ts';

export type MediaTrack = {
  index: number; kind: string; codec: string; profile?: string; level?: number;
  width?: number; height?: number; channels?: number; language?: string;
  bit_rate?: number; sample_rate?: number; frame_rate?: string;
  default?: boolean;
};
export type MediaInspection = {
  status: string;
  media?: { container: string; duration_ms?: number; bit_rate?: number; tracks: MediaTrack[] };
  decision?: { mode: string; reason: string; audio_stream_index?: number };
  error_code?: string;
};

export type StreamState = {
  room_id: string;
  playback_id: string;
  generation: number;
  phase: 'connecting' | 'ready' | 'error';
  url?: string;
  kind?: 'audio' | 'video';
  detail?: string;
  inspection?: MediaInspection;
  audioSelectionAvailable?: boolean;
  converted?: boolean;
  selectedAudioIndex?: number;
  seekSupported?: boolean;
};

const listeners = new Set<() => void>();
let current: StreamState | null = null;
let activeSocket: WebSocket | null = null;
let attachmentKey = '';
let supportsHTTPRebind = false;
let exactCheckKey = '';
let activeDeviceId = '';

export const getStreamState = (): StreamState | null => current;
export function subscribeStreamState(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function emit(): void { for (const listener of listeners) listener(); }
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function validPrivateGateway(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.pathname !== '/ws/stream' ||
        url.search || url.hash || url.username || url.password) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const lan = /^192\.168\.(\d{1,3})\.(\d{1,3})$/.test(host) ||
      /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\.(\d{1,3})\.(\d{1,3})$/.test(host);
    const tail = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host) ||
      host.startsWith('fd7a:');
    const local = host === '127.0.0.1' || host === '::1';
    if (!lan && !tail && !local) return null;
    if (!url.port) return null;
    return url;
  } catch {
    return null;
  }
}
function closeActive(): void {
  supportsHTTPRebind = false;
  exactCheckKey = '';
  activeDeviceId = '';
  const ws = activeSocket;
  activeSocket = null;
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
  }
}
export function resetStream(): void {
  closeActive();
  attachmentKey = '';
  current = null;
  emit();
}
/** Select an inspected audio track on the already authorized Gateway socket.
 * Never construct FFmpeg arguments or media URLs inside the TV app.
 */
export function selectAudioTrack(index: number): boolean {
  if (!Number.isSafeInteger(index) || index < 0 || index > 255 ||
      !current || current.phase !== 'ready' || !current.audioSelectionAvailable ||
      !activeSocket || activeSocket.readyState !== WebSocket.OPEN ||
      !activeDeviceId || !current.inspection?.media?.tracks.some(track =>
        track.kind === 'audio' && track.index === index)) return false;
  activeSocket.send(JSON.stringify({
    v:1, type:'media.audio.select',
    room_id:current.room_id, playback_id:current.playback_id,
    generation:current.generation, device_id:activeDeviceId, audio_index:index,
  }));
  return true;
}

export function sameStream(room: RoomLifecycle, state: StreamState | null): boolean {
  return state?.room_id === room.room_id &&
    state?.playback_id === room.playback_id &&
    state?.generation === room.generation;
}

/** Accept only an offer delivered over the identified Backend control WS. */
export function attachRoomStream(value: unknown, ownDeviceId: string): boolean {
  const o = record(value);
  const target = record(o?.target);
  if (!o || !target || target.device_id !== ownDeviceId ||
      typeof o.room_id !== 'string' || !o.room_id ||
      typeof o.playback_id !== 'string' || !o.playback_id ||
      !Number.isSafeInteger(o.generation) || (o.generation as number) <= 0 ||
      typeof o.attach_ticket !== 'string' ||
      !/^[a-f0-9]{32,128}$/i.test(o.attach_ticket)) return false;
  const endpoint = typeof o.gateway_ws_url === 'string'
    ? validPrivateGateway(o.gateway_ws_url) : null;
  if (!endpoint) return false;

  const roomId = o.room_id;
  const playbackId = o.playback_id;
  const generation = o.generation as number;
  const key = `${roomId}/${playbackId}/${generation}/${o.attach_ticket}`;
  // WS offers can arrive out of order relative to room snapshots and retries.
  // Do not tear down a newer playback when a previous offer arrives late.
  if (current?.room_id === roomId &&
      (generation < current.generation ||
       (generation === current.generation && playbackId !== current.playback_id))) return false;
  if (attachmentKey === key && activeSocket) return true;
  // An opted-in Gateway permits switching media generations on the existing
  // control socket. A fallback to legacy reconnect remains for older servers.
  const reuseSocket = supportsHTTPRebind && activeSocket !== null &&
    activeSocket.readyState === WebSocket.OPEN && activeSocket.url === endpoint.href &&
    current?.room_id === roomId && current.phase === 'ready' &&
    generation > current.generation;
  if (!reuseSocket) closeActive();
  attachmentKey = key;
  exactCheckKey = '';
  current = { room_id: roomId, playback_id: playbackId, generation, phase:'connecting' };
  emit();

  const ws = reuseSocket ? activeSocket! : new WebSocket(endpoint.href);
  activeSocket = ws;
  activeDeviceId = ownDeviceId;
  const sendHello = () => {
    if (activeSocket !== ws) return;
    ws.send(JSON.stringify({
      v:1, type:'media.hello',
      room_id:roomId, playback_id:playbackId,
      generation, device_id:ownDeviceId,
      attach_ticket:o.attach_ticket,
      capabilities:{ http_range:true, http_switch:true, media_inspection:true,
        audio_selection:true, decoder:currentDecoderCapabilities() },
    }));
  };
  ws.onopen = sendHello;
  ws.onmessage = event => {
    if (activeSocket !== ws || typeof event.data !== 'string') return;
    let payload: Record<string, unknown> | null = null;
    try { payload = record(JSON.parse(event.data)); } catch { /* invalid response */ }
    if (!payload) return;
    if (payload.type === 'media.error') {
      current = {room_id:roomId,playback_id:playbackId,generation,phase:'error',detail:'Gateway отклонил подключение'};
      emit();
      return;
    }
    if (payload.type === 'media.convert.error') {
      if (payload.room_id === roomId && payload.playback_id === playbackId &&
          payload.generation === generation && current?.phase === 'ready') {
        current = { ...current, detail:'Gateway не может выполнить преобразование выбранной дорожки' };
        emit();
      }
      return;
    }
    if (payload.type === 'media.convert.ready') {
      if (payload.room_id !== roomId || payload.playback_id !== playbackId ||
          payload.generation !== generation || !current ||
          current.phase !== 'ready' || !current.audioSelectionAvailable) return;
      const convertedPath = payload.http_media_path;
      const selected = payload.audio_index;
      const mediaKind = payload.media_kind;
      if (typeof convertedPath !== 'string' ||
          !/^\/media\/convert\/[a-f0-9]{64}$/i.test(convertedPath) ||
          !Number.isSafeInteger(selected) || typeof selected !== 'number' ||
          !current.inspection?.media?.tracks.some(track =>
            track.kind === 'audio' && track.index === selected) ||
          (mediaKind !== 'audio' && mediaKind !== 'video') ||
          payload.seek_supported !== false) return;
      const src = new URL(endpoint.href);
      src.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
      src.pathname = convertedPath;
      src.search = '';
      src.hash = '';
      current = { ...current, url:src.href, kind:mediaKind, converted:true,
        selectedAudioIndex:selected, seekSupported:false, detail:undefined };
      emit();
      return;
    }
    if (payload.type === 'media.inspection') {
      if (payload.room_id !== roomId || payload.playback_id !== playbackId ||
          payload.generation !== generation || !current || current.phase !== 'ready') return;
      const report = record(payload.report);
      const media = record(report?.media);
      const decision = record(report?.decision);
      const tracks = Array.isArray(media?.tracks) ? media.tracks : [];
      // Never trust unexpected output sizes/fields from a remote socket.
      if (!report || typeof report.status !== 'string' || tracks.length > 32 ||
          (media && (typeof media.container !== 'string' || media.container.length > 64)) ||
          (decision && (typeof decision.mode !== 'string' || typeof decision.reason !== 'string'))) return;
      current = { ...current, inspection:report as MediaInspection };
      emit();
      // Only the Gateway's authorized room socket can receive this report.
      // An exact decoder query refines metadata AFTER ready, not media bytes.
      const requestKey = `${roomId}/${playbackId}/${generation}`;
      if (supportsHTTPRebind && report.status === 'READY' &&
          exactCheckKey !== requestKey) {
        exactCheckKey = requestKey;
        void currentExactDecoder(report as MediaInspection).then(decoder => {
          if (!decoder || !decoder.formats.length ||
              activeSocket !== ws || attachmentKey !== key) return;
          ws.send(JSON.stringify({
            v:1, type:'media.decoder.report', room_id:roomId, playback_id:playbackId,
            generation, device_id:ownDeviceId, capabilities:{decoder},
          }));
        }).catch(() => { /* decoder API unavailable: keep UNKNOWN */ });
      }
      return;
    }
    if (payload.type !== 'media.ready' || payload.room_id !== roomId ||
        payload.playback_id !== playbackId || payload.generation !== generation) return;
    const path = payload.http_media_path;
    const kind = payload.media_kind;
    if (typeof path !== 'string' || !/^\/media\/session\/[a-f0-9]{64}$/i.test(path) ||
        (kind !== 'video' && kind !== 'audio')) {
      current = {room_id:roomId,playback_id:playbackId,generation,phase:'error',
        detail:'Gateway пока не предоставил совместимый источник'};
      emit();
      return;
    }
    const source = new URL(endpoint.href);
    source.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
    source.pathname = path;
    source.search = '';
    source.hash = '';
    supportsHTTPRebind = payload.http_switch === true;
    current = {room_id:roomId,playback_id:playbackId,generation,phase:'ready',
      url:source.href,kind, seekSupported:true,
      audioSelectionAvailable:payload.audio_selection === true};
    emit();
  };
  ws.onerror = () => {
    if (activeSocket !== ws) return;
    current = {room_id:roomId,playback_id:playbackId,generation,phase:'error',
      detail:'Ошибка подключения к Media Gateway'};
    emit();
  };
  ws.onclose = () => {
    if (activeSocket !== ws) return;
    activeSocket = null;
    supportsHTTPRebind = false;
    current = {room_id:roomId,playback_id:playbackId,generation,phase:'error',
      detail:'Прямое соединение с Media Gateway закрыто'};
    emit();
  };
  if (reuseSocket) sendHello();
  return true;
}
