import type { Room } from './mediaControls';

/** Ephemeral, version-fenced UI state. The Backend, not this module, owns rooms. */
export type RoomLifecycle = {
  room_id: string;
  playback_id: string;
  generation: number;
  playback_state: string;
  position_ms: number;
  instance_id: string;
  sequence: number;
};

let active: RoomLifecycle | null = null;
let instance = '';
let watermark = 0;
const listeners = new Set<() => void>();

function notify(): void { for (const fn of listeners) fn(); }
export const getRoomLifecycle = (): RoomLifecycle | null => active;
export function subscribeRoomLifecycle(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function validateNext(next: Room): boolean {
  return Boolean(next.room_id && next.playback_id && next.instance_id &&
    Number.isSafeInteger(next.sequence) && next.sequence > 0 &&
    Number.isSafeInteger(next.generation) && next.generation > 0);
}
function acceptInstance(nextInstance: string, seq: number): boolean {
  if (!nextInstance || !Number.isSafeInteger(seq) || seq < 0) return false;
  if (instance !== nextInstance) { instance = nextInstance; watermark = 0; active = null; }
  if (seq < watermark) return false;
  watermark = Math.max(watermark, seq);
  return true;
}
export function publishRoomLifecycle(next: Room): boolean {
  if (!validateNext(next)) return false;
  if (!acceptInstance(next.instance_id, next.sequence)) return false;
  if (active?.room_id === next.room_id && active.sequence >= next.sequence) return false;
  active = {
    room_id: next.room_id, playback_id: next.playback_id, generation: next.generation,
    playback_state: next.playback_state, position_ms: next.position_ms,
    instance_id: next.instance_id, sequence: next.sequence,
  };
  notify();
  return true;
}

/** A full Backend snapshot is authoritative even if it contains zero rooms.
 * Subscribe to events first, then reconcile with snapshot watermarks. */
export function reconcileRoomLifecycle(rooms: Room[], deviceID: string, instanceID: string, sequence: number): void {
  if (!acceptInstance(instanceID, sequence)) return;
  const found = rooms.find(r => r.target.device_id === deviceID);
  if (found && validateNext(found) && found.instance_id === instanceID) {
    if (active?.room_id === found.room_id && active.sequence > found.sequence) return;
    active = {
      room_id: found.room_id, playback_id: found.playback_id, generation: found.generation,
      playback_state: found.playback_state, position_ms: found.position_ms,
      instance_id: found.instance_id, sequence: found.sequence,
    };
  } else active = null;
  notify();
}

/** STOP is a terminal event, not a playback EOF. A stale closure for an older
 * room must not dismiss an already-created replacement room. */
export function closeRoomLifecycle(roomID: string, instanceID?: string, sequence?: number): void {
  if (!active || active.room_id !== roomID) return;
  if (instanceID && instanceID !== instance) return;
  if (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence < watermark)) return;
  watermark = Math.max(watermark + 1, sequence ?? 0);
  active = null;
  notify();
}

export function resetRoomLifecycle(): void {
  active = null;
  instance = '';
  watermark = 0;
  notify();
}
