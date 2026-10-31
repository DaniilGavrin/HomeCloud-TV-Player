import { invoke } from '@tauri-apps/api/core';
import { getDeviceId } from './serverStorage';
import { normalizeServerAddress } from './serverAddress';

export async function connectToHomeCloud(rawAddress: string): Promise<string> {
  const url = normalizeServerAddress(rawAddress);
  await invoke('ws_connect', { url, deviceId: getDeviceId() });
  return url;
}

export function disconnectHomeCloud(): Promise<void> {
  return invoke('ws_disconnect');
}
