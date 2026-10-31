import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'motion/react';
import { TVButton } from '../../components/TVButton';
import '../../styles/discovery.css';

interface FoundServer {
  ip: string;
  url: string;
  interface: string;
}

interface ScanResult {
  servers: FoundServer[];
  networks: string[];
  checked: number;
  truncated: boolean;
}

interface Props {
  onBack: () => void;
  onSelect: (url: string) => void;
}

export function DiscoveryScreen({ onBack, onSelect }: Props) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const runScan = useCallback(async () => {
    const id = ++seq.current;
    // Cancel the preceding scan before starting a new generation.
    try { await invoke('cancel_lan_discovery'); } catch { /* First start can proceed. */ }
    if (seq.current !== id) return;
    setSearching(true);
    setError(null);
    setResult(null);
    try {
      const found = await invoke<ScanResult>('discover_lan_servers');
      if (seq.current === id) setResult(found);
    } catch (cause) {
      if (seq.current === id) setError(String(cause));
    } finally {
      if (seq.current === id) setSearching(false);
    }
  }, []);

  useEffect(() => {
    void runScan();
    return () => {
      ++seq.current;
      void invoke('cancel_lan_discovery').catch(() => {});
    };
  }, [runScan]);

  const select = (url: string) => {
    ++seq.current;
    void invoke('cancel_lan_discovery').catch(() => {});
    onSelect(url);
  };

  const back = () => {
    ++seq.current;
    void invoke('cancel_lan_discovery').catch(() => {});
    onBack();
  };

  return (
    <div className="tv-screen tv-discovery-screen">
      <p className="tv-eyebrow">HomeCloud · TV Player</p>
      <h1 className="tv-title tv-title--medium">Автообнаружение</h1>
      <p className="tv-subtitle">
        {searching ? 'Ищем HomeCloud в локальной сети…' :
         result?.servers.length ? 'Выберите сервер для подключения' :
         error ? 'Не удалось выполнить поиск' : 'Поиск завершён'}
      </p>

      <div className="tv-discovery-body" aria-live="polite">
        {searching && (
          <div className="tv-discovery-loading" role="status">
            <motion.div
              className="tv-spinner tv-discovery-spinner"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
              aria-hidden="true"
            />
            <p>Проверяем локальные интерфейсы и WebSocket-серверы</p>
          </div>
        )}
        {!searching && result && result.servers.length > 0 && (
          <div className="tv-discovery-list" aria-label="Найденные серверы">
            {result.servers.map((server, index) => (
              <motion.button
                key={server.url}
                type="button"
                className="tv-discovery-item"
                autoFocus={index === 0}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.07, duration: 0.28 }}
                onClick={() => select(server.url)}
              >
                <span className="tv-discovery-dot" aria-hidden="true" />
                <span className="tv-discovery-details">
                  <strong>{server.ip}</strong>
                  <small>{server.url}</small>
                  <small>{server.interface}</small>
                </span>
                <span className="tv-discovery-arrow" aria-hidden="true">›</span>
              </motion.button>
            ))}
          </div>
        )}
        {!searching && result && result.servers.length === 0 && (
          <div className="tv-discovery-empty">
            <strong>Серверы не найдены</strong>
            <p>Убедитесь, что Go Backend запущен на этом LAN и слушает порт 8080.</p>
            <p>Для Tailscale или другого порта используйте ручной ввод.</p>
          </div>
        )}
        {!searching && error && <p className="tv-error tv-discovery-error" role="alert">{error}</p>}
        {!searching && result && (
          <p className="tv-discovery-summary">
            Проверено адресов: {result.checked}
            {result.networks.length > 0 ? ` · Сети: ${result.networks.join(' · ')}` : ' · Нет подходящих локальных интерфейсов'}
            {result.truncated ? ' · Поиск ограничен 1024 адресами' : ''}
          </p>
        )}
      </div>

      <div className="tv-controls tv-discovery-buttons">
        <TVButton kind="primary" disabled={searching} onClick={() => void runScan()}>
          Искать снова
        </TVButton>
        <TVButton onClick={back}>Назад</TVButton>
      </div>
    </div>
  );
}
