import { motion, useReducedMotion } from 'motion/react';

export function SplashScreen() {
  const reducedMotion = useReducedMotion();
  return (
    <div className="tv-screen tv-screen--splash">
      <motion.img
        src="/icon.png"
        alt="HomeCloud TV Player"
        className="tv-brand-logo"
        initial={reducedMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reducedMotion ? 0 : 0.32 }}
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
