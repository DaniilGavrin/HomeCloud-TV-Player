import type { RoomLifecycle } from './roomLifecycle';
import { send } from './mediaControls';
import { createUUID } from './uuid';
import '../styles/tv-room.css';

/** Temporary fullscreen lifecycle surface. KAN-54 does NOT create a decoder.
 * The eventual real player replaces this surface without changing room logic. */
export function RoomPlaceholder({ room }: { room: RoomLifecycle }) {
  const ended = room.playback_state === 'ENDED' || room.playback_state === 'IDLE';
  const stop = () => {
    void send('media.rooms.stop', {
      room_id: room.room_id, command_id: `tv-stop-${createUUID()}`,
    }).catch((e: unknown) => console.error('Stop Viewing failed', e));
  };
  return (
    <section className="hc-room-fullscreen" aria-label="Комната просмотра">
      <div className="hc-room-message" role="status" aria-live="polite">
        <p className="hc-room-kicker">HomeCloud TV Player</p>
        <h1>{ended ? 'Видео завершено' : 'Комната просмотра активна'}</h1>
        <p>{ended ? 'Выберите следующий файл на панели HomeCloud. Комната продолжает работать.' : 'Медиаплеер будет подключён после готовности файлового сервиса и Media Gateway.'}</p>
        <button type="button" className="hc-room-stop" onClick={stop}>Остановить просмотр</button>
      </div>
    </section>
  );
}
