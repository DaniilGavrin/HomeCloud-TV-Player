import { TVButton } from '../../components/TVButton';

interface Props {
  onManual: () => void;
  onDiscovery: () => void;
}

export function ChooseServerScreen({ onManual, onDiscovery }: Props) {
  return (
    <div className="tv-screen">
      <p className="tv-eyebrow">HomeCloud · TV Player</p>
      <h1 className="tv-title tv-title--medium">Подключение</h1>
      <p className="tv-subtitle">Выберите способ подключения к серверу</p>
      <div className="tv-controls tv-controls--choice">
        <TVButton kind="primary" onClick={onManual} autoFocus>Ввести сервер</TVButton>
        <TVButton onClick={onDiscovery}>Автообнаружение сервера</TVButton>
      </div>
    </div>
  );
}
