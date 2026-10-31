import { TVButton } from '../../components/TVButton';

/** KAN-33 placeholder only: discovery protocol and implementation belong to another task. */
export function DiscoveryScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="tv-screen">
      <p className="tv-eyebrow">HomeCloud · TV Player</p>
      <h1 className="tv-title tv-title--medium">Автообнаружение</h1>
      <p className="tv-subtitle">Этот способ подключения будет добавлен позже.</p>
      <div className="tv-controls tv-controls--bottom">
        <TVButton onClick={onBack} autoFocus>Назад</TVButton>
      </div>
    </div>
  );
}
