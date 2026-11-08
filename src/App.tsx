import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { GlassStage } from './components/GlassStage';
import { SplashScreen } from './features/onboarding/SplashScreen';
import { ChooseServerScreen } from './features/onboarding/ChooseServerScreen';
import { ManualServerScreen } from './features/onboarding/ManualServerScreen';
import { DiscoveryScreen } from './features/onboarding/DiscoveryScreen';
import { ConnectingScreen } from './features/onboarding/ConnectingScreen';
import { ConnectedScreen } from './features/onboarding/ConnectedScreen';
import { RoomPlaceholder } from './lib/RoomPlaceholder';
import { TVPlayerShell } from './components/TVPlayerShell';
import { getStreamState, sameStream, subscribeStreamState, selectAudioTrack } from './lib/mediaStream';
import { send } from './lib/mediaControls';
import { createUUID } from './lib/uuid';
import { DevPlayerProbe } from './lib/DevPlayerProbe';
import { MediaControlBridge } from './lib/MediaControlBridge';
import { getRoomLifecycle, subscribeRoomLifecycle } from './lib/roomLifecycle';
import { connectToHomeCloud, disconnectHomeCloud } from './lib/connection';
import { getSavedServer, saveServer } from './lib/serverStorage';
import './App.css';
import './styles/tv-shell.css';

type Screen = 'splash' | 'choose' | 'manual' | 'discovery' | 'connecting' | 'connected';
type WsStatus = { status: 'connected' | 'disconnected' | 'error'; detail: string };

const titles: Record<Screen, string> = {
  splash: 'Запуск TV Player',
  choose: 'Выбор подключения',
  manual: 'Ввод сервера',
  discovery: 'Автообнаружение сервера',
  connecting: 'Подключение к серверу',
  connected: 'TV Player',
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const roomView = useSyncExternalStore(subscribeRoomLifecycle, getRoomLifecycle, getRoomLifecycle);
  const streamView = useSyncExternalStore(subscribeStreamState, getStreamState, getStreamState);
  const playingRoom = Boolean(roomView && streamView?.phase === 'ready' &&
    streamView.url && sameStream(roomView,streamView) &&
    roomView.playback_state !== 'ENDED' && roomView.playback_state !== 'IDLE');
  const [address, setAddress] = useState(() => getSavedServer() ?? '');
  const [error, setError] = useState<string | null>(null);
  // Distinguishes an old/cancelled connection result from the current attempt.
  const requestId = useRef(0);
  const activeScreen = useRef<Screen>('splash');
  useEffect(() => { activeScreen.current = screen; }, [screen]);

  const connect = useCallback(async (rawAddress: string) => {
    const attempt = ++requestId.current;
    setError(null);
    setScreen('connecting');

    try {
      const normalizedUrl = await connectToHomeCloud(rawAddress);
      if (requestId.current !== attempt) return;
      saveServer(normalizedUrl); // Persist ONLY after identified handshake succeeds.
      setAddress(normalizedUrl);
      setScreen('connected');
    } catch (cause) {
      if (requestId.current !== attempt) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setScreen('manual');
    }
  }, []);

  const cancelConnection = useCallback(() => {
    requestId.current += 1;
    void disconnectHomeCloud().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    setScreen('manual');
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<WsStatus>('tv-player-ws-status', (event) => {
      if (disposed || event.payload.status === 'connected') return;
      if (event.payload.status === 'disconnected' || event.payload.status === 'error') {
        // Only navigate away when an established connection has been lost.
        if (activeScreen.current === 'connected') {
          setError(event.payload.detail || 'Соединение с сервером прервано.');
          setScreen('manual');
        }
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((cause: unknown) => {
      // Do not block the initial splash for an optional status listener.
      console.error('Unable to subscribe to WebSocket status:', cause);
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = getSavedServer();
      if (saved) void connect(saved);
      else setScreen('choose');
    }, 1900);
    return () => window.clearTimeout(timer);
  }, [connect]);

  return (
    <main className="tv-app" aria-label="HomeCloud TV Player">
      <div className="tv-background" aria-hidden="true" />
      <div className="tv-backdrop-dim" aria-hidden="true" />
      <div className="tv-stage-wrapper">
        <GlassStage screenName={titles[screen]}>
            {screen === 'splash' && <SplashScreen />}
            {screen === 'choose' && (
              <ChooseServerScreen
                onManual={() => { setError(null); setScreen('manual'); }}
                onDiscovery={() => setScreen('discovery')}
              />
            )}
            {screen === 'manual' && (
              <ManualServerScreen
                address={address}
                error={error}
                onAddressChange={(value) => { setAddress(value); setError(null); }}
                onConnect={() => void connect(address)}
                onBack={() => { setError(null); setScreen('choose'); }}
              />
            )}
            {screen === 'discovery' && <DiscoveryScreen onBack={() => setScreen('choose')} onSelect={(url) => { setAddress(url); void connect(url); }} />}
            {screen === 'connecting' && <ConnectingScreen onBack={cancelConnection} />}
            {screen === 'connected' && <ConnectedScreen />}
        </GlassStage>
      </div>
      {screen === 'connected' && roomView && (
        playingRoom && streamView?.url ? (
          <TVPlayerShell
            key={`${roomView.room_id}:${roomView.playback_id}:${roomView.generation}`}
            title="HomeCloud Media"
            sourceUrl={streamView.url}
            roomId={roomView.room_id}
            playbackId={roomView.playback_id}
            generation={roomView.generation}
            mediaKind={streamView.kind ?? 'video'}
            inspection={streamView.inspection}
            audioSelectionAvailable={streamView.audioSelectionAvailable}
            selectedAudioIndex={streamView.selectedAudioIndex}
            seekSupported={streamView.seekSupported}
            shouldAutoplay={roomView.playback_state !== 'PAUSED'}
            transportNotice={streamView.detail}
            onSelectAudioTrack={selectAudioTrack}
            onClose={() => {
              void send('media.rooms.stop', {
                room_id:roomView.room_id,command_id:`tv-stop-${createUUID()}`,
              }).catch(console.error);
            }}
          />
        ) : <RoomPlaceholder room={roomView} />
      )}
      {screen === 'connected' && <MediaControlBridge />}
      {screen === 'connected' && <DevPlayerProbe />}
    </main>
  );
}
