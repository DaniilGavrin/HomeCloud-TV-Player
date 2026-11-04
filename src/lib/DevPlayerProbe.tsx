/**
 * KAN-74/KAN-75 TEMPORARY WS test adapter. Remove alongside
 * scripts/Dev-Open-TVPlayer.ps1 after test completion.
 * Back/D-pad navigation is owned by TVPlayerShell, not duplicated here.
 */
import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { TVPlayerShell } from '../components/TVPlayerShell';

type Probe = { title: string };

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Accept only the explicitly namespaced, address-routed test command. */
export function decodeDevPlayerOpen(message: unknown): Probe | null {
  const msg = asObject(message);
  if (msg?.type !== 'event' || msg.topic !== 'clients.message') return null;
  const envelope = asObject(msg.data);
  const payload = asObject(envelope?.payload);
  if (!payload || payload.kind !== 'dev.tv.player.open') return null;
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim().slice(0, 80)
    : 'Тестовый запуск плеера';
  return { title };
}

export function DevPlayerProbe() {
  const [probe, setProbe] = useState<Probe | null>(null);
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<unknown>('tv-player-ws-message', (event) => {
      if (disposed) return;
      const next = decodeDevPlayerOpen(event.payload);
      if (next) setProbe(next);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error: unknown) => console.error('Temporary TV probe listener:', error));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  return probe ? <TVPlayerShell title={probe.title} testMode onClose={() => setProbe(null)} /> : null;
}
