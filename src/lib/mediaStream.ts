/** KAN-59 HTTP media attachment.
 * A direct WebSocket consumes the Backend-issued one-time TV ticket. The
 * Gateway replies with a short-lived, room/peer-bound HTTP Range URL for
 * WebView's native audio/video decoder. Never accept media URLs from panels.
 */
import type { RoomLifecycle } from './roomLifecycle';

export type StreamState = {
  room_id: string;
  playback_id: string;
  generation: number;
  phase: 'connecting' | 'ready' | 'error';
  url?: string;
  kind?: 'audio' | 'video';
  detail?: string;
};

const listeners = new Set<() => void>();
let current: StreamState | null = null;
let activeSocket: WebSocket | null = null;
let attachmentKey = '';

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
  if (attachmentKey === key && activeSocket) return true;
  closeActive();
  attachmentKey = key;
  current = { room_id: roomId, playback_id: playbackId, generation, phase:'connecting' };
  emit();

  const ws = new WebSocket(endpoint.href);
  activeSocket = ws;
  ws.onopen = () => {
    if (activeSocket !== ws) return;
    ws.send(JSON.stringify({
      v:1, type:'media.hello',
      room_id:roomId, playback_id:playbackId,
      generation, device_id:ownDeviceId,
      attach_ticket:o.attach_ticket,
      capabilities:{ http_range:true },
    }));
  };
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
    current = {room_id:roomId,playback_id:playbackId,generation,phase:'ready',
      url:source.href,kind};
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
    current = {room_id:roomId,playback_id:playbackId,generation,phase:'error',
      detail:'Прямое соединение с Media Gateway закрыто'};
    emit();
  };
  return true;
}
