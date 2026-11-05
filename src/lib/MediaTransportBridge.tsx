import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { attachMediaOffer, closeMediaSession } from './mediaSession';
import { getDeviceId } from './serverStorage';
import type { WSMessage } from './mediaControls';

/** React lifecycle anchor for the Backend -> Gateway attach. Backend supplies
 * the one-use grant; the TV never names an HC SS file or arbitrary media URL. */
export function MediaTransportBridge() {
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<WSMessage>('tv-player-ws-message', (event) => {
      if (disposed) return;
      const message = event.payload;
      if (message.type !== 'event') return;
      const data = message.data;
      if (message.topic === 'media.room.offer' && data && typeof data === 'object') {
        const envelope = data as Record<string, unknown>;
        const offer = envelope.target ? data : envelope.payload;
        attachMediaOffer(offer, getDeviceId());
      }
      if (message.topic === 'media.room.closed') {
        const obj = data && typeof data === 'object' ? data as Record<string, unknown> : null;
        const payload = obj?.payload && typeof obj.payload === 'object'
          ? obj.payload as Record<string, unknown> : obj;
        if (typeof payload?.room_id === 'string') closeMediaSession(payload.room_id);
      }
    }).then(stop => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(error => console.error('Media transport listener:', error));
    return () => {
      disposed = true;
      unlisten?.();
      closeMediaSession();
    };
  }, []);
  return null;
}
