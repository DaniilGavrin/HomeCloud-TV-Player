import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface GlassStageProps {
  children: ReactNode;
  screenName: string;
}

/** Keyed by the parent via AnimatePresence: one continuous glass panel per screen. */
export function GlassStage({ children, screenName }: GlassStageProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.section
      className="tv-glass-stage"
      aria-label={screenName}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.36, filter: 'blur(14px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.76, filter: 'blur(9px)' }}
      transition={{ duration: reducedMotion ? 0.12 : 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        className="tv-glass-content"
        initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reducedMotion ? 0 : 0.11, duration: 0.28 }}
      >
        {children}
      </motion.div>
    </motion.section>
  );
}
