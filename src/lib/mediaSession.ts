/**
 * Room-scoped Android WebView HTTP Range attachment. No paths or media URLs
 * are accepted from a panel/TV command: only a one-use Backend-issued
 * media.room.offer can mint a Gateway URL for this playback generation.
 *
 * The WebSocket stays connected for the entire playback. Closing it revokes
 * the Gateway session. Native Android/WebView media decoding uses HTTP Range.
 */
export type MediaSession = {
  roomId: string;
  playbackId: string;
  generation: number;
  phase: 'connecting' | 'ready' | 'error';
  url?: string;
  mediaKind?: 'audio' | 'video';
  contentType?: string;
  error?: string;
};
type RoomOffer = {
  room_id: string;
  playback_id: string;
  generation: number;
  gateway_ws_url: string;
  attach_ticket: string;
  target: { device_id: string };
};
let current: MediaSession | null = null;
let activeSocket: WebSocket | null = null;
let activeKey = '';
let generation = 0;
const listeners = new Set<() => void>();
function emit() { for (const cb of listeners) cb(); }
function publish(next: MediaSession | null) { current = next; emit(); }
export const getMediaSession = () => current;
export function subscribeMediaSession(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function object(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown> : null;
}
function privateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '::1' || host.startsWith('fd') || host.startsWith('fc')) return true;
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every(v => /^\d{1,3}$/.test(v))) return false;
  const p = parts.map(Number);
  if (p.some(v => v < 0 || v > 255)) return false;
  return p[0] === 10 || p[0] === 127 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
function validatedGateway(raw: string): URL {
  const url = new URL(raw);
  if (!['ws:', 'wss:'].includes(url.protocol) || !url.port ||
      url.pathname !== '/ws/stream' || url.search || url.hash ||
      url.username || url.password || !privateAddress(url.hostname)) {
    throw new Error('Недопустимый адрес частного Media Gateway');
  }
  return url;
}
export function closeMediaSession(roomId?: string) {
  if (roomId && current?.roomId !== roomId) return;
  ++generation;
  const socket = activeSocket;
  activeSocket = null;
  activeKey = '';
  publish(null);
  try { socket?.close(); } catch { /* obsolete socket */ }
}
export function attachMediaOffer(payload: unknown, deviceId: string): boolean {
  const data = object(payload);
  const target = object(data?.target);
  if (!data || target?.device_id !== deviceId ||
      typeof data.room_id !== 'string' || !data.room_id ||
      typeof data.playback_id !== 'string' || !data.playback_id ||
      !Number.isSafeInteger(data.generation) || Number(data.generation) < 1 ||
      typeof data.gateway_ws_url !== 'string' ||
      typeof data.attach_ticket !== 'string' ||
      !/^[a-fA-F0-9]{32,128}$/.test(data.attach_ticket)) return false;
  const offer = data as unknown as RoomOffer;
  const key = `${offer.room_id}:${offer.playback_id}:${offer.generation}`;
  if (key === activeKey && current?.phase !== 'error') return true;
  let endpoint: URL;
  try { endpoint = validatedGateway(offer.gateway_ws_url); }
  catch (e) { console.error('Invalid Gateway offer:', e); return false; }
  closeMediaSession();
  const expected = ++generation;
  activeKey = key;
  const base: MediaSession = {
    roomId: offer.room_id, playbackId: offer.playback_id,
    generation: offer.generation, phase: 'connecting',
  };
  publish(base);
  let socket: WebSocket;
  try { socket = new WebSocket(endpoint.href); }
  catch (e) {
    publish({ ...base, phase: 'error', error: String(e) });
    return false;
  }
  activeSocket = socket;
  const live = () => expected === generation && activeSocket === socket;
  const failed = (reason: string) => {
    if (!live()) return;
    publish({ ...base, phase: 'error', error: reason });
    try { socket.close(); } catch { /* ignore */ }
  };
  const timeout = window.setTimeout(() => failed('Media Gateway не ответил на подключение'), 12000);
  socket.onopen = () => {
    if (!live()) return;
    socket.send(JSON.stringify({
      v: 1, type: 'media.hello', room_id: offer.room_id,
      playback_id: offer.playback_id, generation: offer.generation,
      device_id: deviceId, attach_ticket: offer.attach_ticket,
      capabilities: { http_range: true },
    }));
  };
  socket.onmessage = (event: MessageEvent) => {
    if (!live() || typeof event.data !== 'string') return;
    let data: Record<string, unknown> | null;
    try { data = object(JSON.parse(event.data)); } catch { return failed('Ошибка протокола Gateway'); }
    if (data?.type === 'media.error') {
      window.clearTimeout(timeout);
      failed('Gateway отклонил подключение: ' + String(data.code ?? 'unknown'));
      return;
    }
    if (data?.type !== 'media.ready') return;
    window.clearTimeout(timeout);
    if (data.room_id !== offer.room_id || data.playback_id !== offer.playback_id ||
        data.generation !== offer.generation || !Number.isSafeInteger(data.connection_epoch) ||
        typeof data.http_media_path !== 'string' ||
        !/^\/media\/session\/[a-f0-9]{64}$/.test(data.http_media_path) ||
        !['audio', 'video'].includes(String(data.media_kind)) ||
        typeof data.content_type !== 'string') {
      return failed('Gateway не предоставил корректный HTTP-медиапоток');
    }
    const mediaURL = new URL(data.http_media_path, endpoint.href);
    mediaURL.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
    publish({
      ...base, phase: 'ready', url: mediaURL.href,
      mediaKind: data.media_kind as 'audio' | 'video',
      contentType: data.content_type,
    });
  };
  socket.onerror = () => {
    if (live()) failed('Нет соединения с Media Gateway');
  };
  socket.onclose = () => {
    window.clearTimeout(timeout);
    if (live()) {
      publish({ ...base, phase: 'error', error: 'Медиасоединение закрыто' });
      activeSocket = null;
    }
  };
  return true;
}
