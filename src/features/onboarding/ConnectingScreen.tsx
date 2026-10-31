import { motion, useReducedMotion } from 'motion/react';
import { TVButton } from '../../components/TVButton';

export function ConnectingScreen({ onBack }: { onBack: () => void }) {
  const reducedMotion = useReducedMotion();
  return (
    <div className="tv-screen">
      <motion.div
        className="tv-spinner"
        aria-hidden="true"
        animate={reducedMotion ? undefined : { rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.25, ease: 'linear' }}
      />
      <h1 className="tv-title tv-title--medium">Подключение к серверу</h1>
      <p className="tv-subtitle" role="status">Ожидание ответа HomeCloud…</p>
      <div className="tv-controls tv-controls--bottom">
        <TVButton onClick={onBack}>Назад</TVButton>
      </div>
    </div>
  );
}
