import { invoke } from '@tauri-apps/api/core';
import { createUUID } from './uuid';

/** Room-state adapter for the control plane; a decoder must supply a live
 * video[data-homecloud-media] element before commands can be acknowledged. */
export type Room = {
  room_id: string;
  playback_id: string;
  generation: number;
  attach_epoch: number;
  room_state: string;
  playback_state: string;
  tv_attach: string;
  target: { device_id: string };
  position_ms: number;
  volume?: number;
  muted?: boolean;
  sequence: number;
  instance_id: string;
};

export type Control = {
  room_id: string;
  playback_id: string;
  generation: number;
  connection_epoch: number;
  command_id: string;
  command_sequence: number;
  action: string;
  volume?: number;
  muted?: boolean;
};

export type WSMessage = {
  type: string;
  action?: string;
  topic?: string;
  data?: unknown;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
export function parseRoom(value: unknown): Room | null {
  const v = object(value);
  const target = object(v?.target);
  if (!v || !target || typeof v.room_id !== 'string' || typeof v.playback_id !== 'string' ||
    typeof v.generation !== 'number' || typeof target.device_id !== 'string' ||
    typeof v.attach_epoch !== 'number') return null;
  return v as unknown as Room;
}
export function isSameRoom(control: Control, room: Room): boolean {
  return control.room_id === room.room_id && control.playback_id === room.playback_id &&
    control.generation === room.generation && control.connection_epoch === room.attach_epoch;
}

export function player(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('video[data-homecloud-media]');
}
export function canExecute(video: HTMLVideoElement | null): video is HTMLVideoElement {
  // No dummy video element, and no claiming success without attached playable media.
  return video !== null && video.readyState > HTMLMediaElement.HAVE_NOTHING;
}

export async function send(action: string, data: Record<string, unknown>): Promise<void> {
  await invoke('ws_media_command', { action, data, id: `tv-${createUUID()}` });
}
export async function applyToPlayer(video: HTMLVideoElement, control: Pick<Control, 'action'|'volume'|'muted'>): Promise<void> {
  switch (control.action) {
    case 'pause': video.pause(); break;
    case 'play':
    case 'resume': await video.play(); break;
    case 'volume':
      if (!Number.isInteger(control.volume) || control.volume! < 0 || control.volume! > 100) throw new Error('Invalid volume');
      video.volume = control.volume! / 100; break;
    case 'mute':
      if (typeof control.muted !== 'boolean') throw new Error('Invalid mute');
      video.muted = control.muted; break;
    default: throw new Error('Unsupported playback command');
  }
}

export async function acknowledge(control: Control, phase: 'APPLIED'|'FAILED', errorCode?: string): Promise<void> {
  await send('media.room.control.ack', {
    room_id: control.room_id, playback_id: control.playback_id,
    generation: control.generation, connection_epoch: control.connection_epoch,
    command_id: control.command_id, command_sequence: control.command_sequence,
    participant: 'tv', phase,
    ...(errorCode ? { error_code: errorCode } : {}),
  });
}
