import type { FormEvent } from 'react';
import { TVButton } from '../../components/TVButton';

interface Props {
  address: string;
  error: string | null;
  onAddressChange: (value: string) => void;
  onConnect: () => void;
  onBack: () => void;
}

export function ManualServerScreen({ address, error, onAddressChange, onConnect, onBack }: Props) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConnect();
  };

  return (
    <div className="tv-screen">
      <p className="tv-eyebrow">HomeCloud · TV Player</p>
      <h1 className="tv-title tv-title--medium">Адрес сервера</h1>
      <form className="tv-controls" onSubmit={submit}>
        <label className="tv-field-label" htmlFor="tv-server-address">IP-адрес или адрес WebSocket</label>
        <input
          className="tv-input"
          id="tv-server-address"
          type="text"
          value={address}
          onChange={(event) => onAddressChange(event.target.value)}
          placeholder="192.168.1.100:8080"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'tv-server-error' : undefined}
          autoFocus
        />
        {error && <p id="tv-server-error" className="tv-error" role="alert">{error}</p>}
        <div className="tv-form-buttons">
          <TVButton type="submit" kind="primary">Подключиться</TVButton>
          <TVButton onClick={onBack}>Назад</TVButton>
        </div>
      </form>
    </div>
  );
}
