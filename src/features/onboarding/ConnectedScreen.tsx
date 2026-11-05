import { motion, useReducedMotion } from 'motion/react';
import '../../styles/tv-waiting.css';

/**
 * KAN-34 — Main connected screen.
 * An infinite CSS spinner indicates that we're waiting for a stream command.
 * Playback, D-pad controls and stream commands are not part of this screen.
 */
export function ConnectedScreen() {
  const reducedMotion = useReducedMotion();

  return (
    <div className="tv-screen tv-waiting-screen" role="status" aria-live="polite">
      <div className="tv-waiting-content">
        {/* Deliberately NOT a motion.div. The status spinner must keep turning
            even if the OS/WebView reports a reduced-motion preference. */}
        <div className="tv-waiting-spinner" aria-hidden="true">
          <span className="tv-waiting-spinner-ring" />
        </div>

        <motion.h1
          className="tv-waiting-title"
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.46, delay: reducedMotion ? 0 : 0.1 }}
        >
          Ожидание потока от сервера
        </motion.h1>
      </div>
    </div>
  );
}
