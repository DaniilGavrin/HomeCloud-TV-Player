import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './App.css';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
interface StatusEvent { status: ConnectionStatus; detail: string }

function getDeviceId(): string {
  const key = 'hctv:device-id';
  try {
    const previous = localStorage.getItem(key);
    if (previous) return previous;
    const id = `hc-tv-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `hc-tv-${crypto.randomUUID()}`;
  }
}

export default function App() {
  const [url, setUrl] = useState(() => localStorage.getItem('hctv:ws-url') ?? 'ws://127.0.0.1:8080/ws');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [detail, setDetail] = useState('HomeCloud connection is not configured');
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const handlers: UnlistenFn[] = [];
    void Promise.all([
      listen<StatusEvent>('tv-player-ws-status', event => {
        if (!cancelled) {
          setStatus(event.payload.status);
          setDetail(event.payload.detail);
        }
      }),
      listen<string>('tv-player-ws-message', event => {
        if (!cancelled) setMessages(previous => [event.payload, ...previous].slice(0, 8));
      }),
    ]).then(unlisten => {
      if (cancelled) unlisten.forEach(fn => fn());
      else handlers.push(...unlisten);
    }).catch(error => {
      if (!cancelled) setDetail(`Event listener: ${String(error)}`);
    });
    return () => {
      cancelled = true;
      handlers.forEach(fn => fn());
    };
  }, []);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setDetail('Connecting to HomeCloud Go backend...');
    setMessages([]);
    try {
      localStorage.setItem('hctv:ws-url', url.trim());
      await invoke('ws_connect', { url: url.trim(), deviceId: getDeviceId() });
      setStatus('connected');
      setDetail('Identified by HomeCloud backend');
    } catch (error) {
      setStatus('error');
      setDetail(String(error));
    }
  }, [url]);

  const disconnect = async () => {
    try { await invoke('ws_disconnect'); }
    catch (error) { setDetail(String(error)); }
  };

  const systemStatus = async () => {
    try {
      await invoke('ws_send', {
        payload: JSON.stringify({ v: 1, id: crypto.randomUUID(), type: 'command', action: 'system.status' }),
      });
    } catch (error) {
      setDetail(String(error));
    }
  };

  return (
    <main className="min-h-screen bg-[#080f1b] text-slate-100 selection:bg-sky-400/30">
      <div className="mx-auto max-w-5xl px-6 py-14">
        <div className="mb-12 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.28em] text-sky-300">ByteWizard · HomeCloud</p>
            <h1 className="text-5xl font-semibold tracking-tight">TV Player</h1>
            <p className="mt-3 text-slate-400">Tauri 2 · Rust WebSocket · React · Tailwind 3.4</p>
          </div>
          <span className={`rounded-full border px-4 py-2 text-sm ${status === 'connected' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : status === 'error' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-slate-500/40 bg-slate-500/10 text-slate-300'}`}>
            {status}
          </span>
        </div>
        <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-7 shadow-xl shadow-black/20 backdrop-blur-lg">
          <h2 className="text-xl font-medium">HomeCloud connection</h2>
          <p className="mt-2 text-sm text-slate-400">Go WebSocket handshake and messages are processed in Rust.</p>
          <label htmlFor="endpoint" className="mb-2 mt-6 block text-sm text-slate-300">Private WS address</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input id="endpoint" aria-label="HomeCloud WebSocket endpoint" value={url} onChange={e => setUrl(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/25 px-4 py-3 font-mono text-sm text-white outline-none focus:border-sky-400"
              placeholder="ws://192.168.1.10:8080/ws" />
            <button onClick={() => void connect()} disabled={status === 'connecting'} className="rounded-xl bg-sky-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-sky-300 disabled:opacity-50">Connect</button>
            <button onClick={() => void disconnect()} className="rounded-xl border border-white/20 px-5 py-3 transition hover:bg-white/10">Disconnect</button>
          </div>
          <p role="status" className="mt-4 break-words text-sm text-slate-400">{detail}</p>
        </section>
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.035] p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><h2 className="text-xl font-medium">WebSocket diagnostics</h2><p className="mt-1 text-sm text-slate-400">Recent Go messages (limited to eight)</p></div>
            <button onClick={() => void systemStatus()} disabled={status !== 'connected'} className="rounded-xl border border-sky-300/30 px-4 py-3 text-sm text-sky-200 hover:bg-sky-300/10 disabled:cursor-not-allowed disabled:opacity-40">system.status</button>
          </div>
          <div className="mt-5 min-h-32 space-y-3 font-mono text-xs text-slate-300">
            {messages.length ? messages.map((msg, i) => <pre key={`${i}-${msg.slice(0, 20)}`} className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-black/30 p-4">{msg}</pre>) : <p className="text-slate-500">No messages yet.</p>}
          </div>
        </section>
        <p className="mt-8 text-sm text-slate-500">Starter foundation only. Playback, media library and remote navigation are separate TV Player features.</p>
      </div>
    </main>
  );
}
