import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getDeviceId } from './serverStorage';
import { createUUID } from './uuid';
import { acknowledge, applyToPlayer, canExecute, isSameRoom, parseRoom, player, send, type Control, type Room, type WSMessage } from './mediaControls';
import { publishRoomLifecycle, reconcileRoomLifecycle, closeRoomLifecycle, resetRoomLifecycle } from './roomLifecycle';

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
/** Control adapter only. It does not create a fake media decoder or claim that
 * a requested PLAY succeeded; the actual video element is provided later. */
export function MediaControlBridge() {
  useEffect(() => {
    let room: Room | null = null;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let reportSequence = 0;
    let lastControlSequence = 0;
    let lastInstance = '';
    let lastVersion = 0;
    const install = (raw: unknown) => {
      const next = parseRoom(raw);
      if (next?.target.device_id !== getDeviceId()) return;
      if (next.instance_id === lastInstance && next.sequence < lastVersion) return;
      if (next.instance_id !== lastInstance) { lastInstance = next.instance_id; lastVersion = 0; }
      if (!room || room.room_id !== next.room_id || room.playback_id !== next.playback_id || room.attach_epoch !== next.attach_epoch) { reportSequence = 0; lastControlSequence = 0; }
      lastVersion = Math.max(lastVersion, next.sequence);
      if (!publishRoomLifecycle(next)) return;
      room = next;
      // Recover an offer that arrived before the React listener mounted.
      // This acknowledges room metadata only, NEVER decoder readiness.
      const participants = obj(obj(raw)?.participants);
      if (participants?.tv === 'PENDING') {
        void send('media.room.participant', {
          room_id: next.room_id, playback_id: next.playback_id,
          participant: 'tv', phase: 'APPLIED',
        }).catch(console.error);
      }
    };
    const notifyObserved = async (state: string) => {
      const current = room;
      const video = player();
      if (!current || !canExecute(video) || current.attach_epoch <= 0) return;
      reportSequence += 1;
      await send('media.room.report', {
        room_id: current.room_id, playback_id: current.playback_id,
        generation: current.generation, connection_epoch: current.attach_epoch,
        participant: 'tv', report_sequence: reportSequence,
        state, position_ms: Math.max(0, Math.floor(video.currentTime * 1000)),
      });
    };
    const onMessage = async (message: WSMessage) => {
      if (disposed) return;
      if (message.type === 'result' && message.action === 'media.rooms.snapshot') {
        const data = obj(message.data);
        if (Array.isArray(data?.rooms) && typeof data?.instance_id === 'string' && typeof data?.sequence === 'number') {
          if (data.instance_id === lastInstance && data.sequence < lastVersion) return;
          if (data.instance_id !== lastInstance) { lastInstance = data.instance_id; lastVersion = 0; }
          const own = (data.rooms as unknown[]).map(parseRoom).filter((v): v is Room => v !== null);
          const selected = own.find(v => v.target.device_id === getDeviceId()) ?? null;
          if (selected) install(selected);
          else { room = null; reportSequence = 0; lastControlSequence = 0; }
          reconcileRoomLifecycle(own, getDeviceId(), data.instance_id, data.sequence);
          lastInstance = data.instance_id;
          lastVersion = Math.max(lastVersion, data.sequence);
        }
      }
      if (message.type !== 'event') return;
      if (message.topic === 'media.room.changed') {
        const data = obj(message.data);
        install(data?.payload);
      }
      if (message.topic === 'media.room.offer') {
        // Offers may arrive before the decoder is available. Acknowledging an
        // offer means the TV accepted room metadata, never that media is playing.
        const data = obj(message.data);
        if (data && obj(data.target)?.device_id === getDeviceId()) {
          await send('media.room.participant', {
            room_id: data.room_id, playback_id: data.playback_id,
            participant: 'tv', phase: 'APPLIED',
          });
          await send('media.rooms.snapshot', {});
        }
      }
      if (message.topic === 'media.room.closed') {
        const data = obj(message.data);
        const payload = obj(data?.payload) ?? data;
        if (payload && room && payload.room_id === room.room_id) {
          const seq = typeof payload.sequence === 'number' ? payload.sequence : undefined;
          if (payload.instance_id === lastInstance && seq !== undefined && seq < lastVersion) return;
          closeRoomLifecycle(room.room_id,
            typeof payload.instance_id === 'string' ? payload.instance_id : undefined, seq);
          if (seq !== undefined) lastVersion = Math.max(lastVersion, seq);
          room = null; reportSequence = 0; lastControlSequence = 0;
        }
      }
      if (message.topic !== 'media.room.control') return;
      const c = obj(message.data) as unknown as Control | null;
      const current = room;
      if (!c || !current || !isSameRoom(c, current)) return;
      if (!Number.isSafeInteger(c.command_sequence) || c.command_sequence <= lastControlSequence) return;
      lastControlSequence = c.command_sequence;
      const video = player();
      if (!canExecute(video)) {
        await acknowledge(c, 'FAILED', 'PLAYER_NOT_READY');
        return;
      }
      try { await applyToPlayer(video, c); if (c.command_sequence === lastControlSequence) await acknowledge(c, 'APPLIED'); }
      catch { await acknowledge(c, 'FAILED', 'EXECUTION_FAILED'); }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      const current = room;
      if (!current || ev.repeat) return;
      if (ev.key === 'MediaStop' || ev.key === 'Escape' || ev.key === 'Backspace' || ev.key === 'BrowserBack') {
        ev.preventDefault();
        // Never tear down the UI on request: wait for authoritative CLOSED.
        void send('media.rooms.stop', {
          room_id: current.room_id, command_id: `tv-stop-${createUUID()}`,
        }).catch(console.error);
        return;
      }
      const video = player();
      if (!canExecute(video) || current.attach_epoch <= 0) return;
      let action: string | null = null;
      let extra: Record<string, unknown> = {};
      switch (ev.key) {
        case 'MediaPlayPause': action = video.paused ? 'resume' : 'pause'; break;
        case 'MediaPlay': action = 'resume'; break;
        case 'MediaPause': action = 'pause'; break;
        case 'AudioVolumeUp': action = 'volume'; extra = { volume: Math.min(100, Math.round(video.volume * 100) + 5) }; break;
        case 'AudioVolumeDown': action = 'volume'; extra = { volume: Math.max(0, Math.round(video.volume * 100) - 5) }; break;
        case 'AudioVolumeMute': action = 'mute'; extra = { muted: !video.muted }; break;
      }
      if (!action) return;
      ev.preventDefault();
      // Apply first, then send a TV-originated notification. Backend won't echo it.
      void (async () => {
        try {
          await applyToPlayer(video, { action: action!, ...extra });
          await send('media.room.control', {
            room_id: current.room_id, playback_id: current.playback_id,
            generation: current.generation, command_id: `remote-${createUUID()}`,
            action, ...extra,
          });
        } catch (error) { console.error('TV remote execution failed', error); }
      })();
    };
    const onPlay = () => { void notifyObserved('PLAYING').catch(console.error); };
    const onPause = () => { void notifyObserved('PAUSED').catch(console.error); };
    const onEnded = (ev: Event) => {
      const target = ev.target;
      if (!(target instanceof HTMLVideoElement) || !target.matches('video[data-homecloud-media]') || !room) return;
      void (async () => {
        try { await notifyObserved('ENDED'); }
        catch (e) { console.error('Unable to publish true decoder EOF', e); }
        finally {
          // Release the old decoder buffer, not the room or control WS.
          target.pause();
          target.removeAttribute('src');
          target.srcObject = null;
          target.load();
        }
      })();
    };
    // Capturing document listener also works when the actual video element is
    // mounted AFTER the bridge (which is how the future player will work).
    document.addEventListener('ended', onEnded, true);
    // Polling is avoided on low-power Android TV hardware.
    const video = player();
    video?.addEventListener('playing', onPlay);
    video?.addEventListener('pause', onPause);
    window.addEventListener('keydown', onKeyDown);
    void listen<WSMessage>('tv-player-ws-message', (event) => { void onMessage(event.payload).catch(console.error); })
      .then((stop) => {
        if (disposed) { stop(); return; }
        unlisten = stop;
        // Always request a fresh snapshot only AFTER event subscription.
        void send('media.rooms.snapshot', {}).catch(console.error);
      });
    const hb = window.setInterval(() => {
      if (!room || disposed) return;
      void send('media.room.heartbeat', {
        room_id: room.room_id, playback_id: room.playback_id,
        generation: room.generation, participant: 'tv',
      }).catch(console.error);
    }, 20_000);
    return () => {
      disposed = true;
      window.clearInterval(hb);
      unlisten?.();
      window.removeEventListener('keydown', onKeyDown);
      video?.removeEventListener('playing', onPlay);
      video?.removeEventListener('pause', onPause);
      document.removeEventListener('ended', onEnded, true);
      resetRoomLifecycle();
    };
  }, []);
  return null;
}
