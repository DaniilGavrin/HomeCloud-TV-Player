import { motion, useReducedMotion } from 'motion/react';

export function SplashScreen() {
  const reducedMotion = useReducedMotion();
  return (
    <div className="tv-screen tv-screen--splash">
      <motion.div
        className="tv-brand-orb"
        aria-hidden="true"
        initial={reducedMotion ? undefined : { scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.p className="tv-eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.24 }}>
        HomeCloud
      </motion.p>
      <motion.h1 className="tv-title" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.36, duration: 0.5 }}>
        TV Player
      </motion.h1>
      <motion.div className="tv-loading-bar" aria-hidden="true">
        <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.45, ease: 'easeInOut' }} />
      </motion.div>
    </div>
  );
}
