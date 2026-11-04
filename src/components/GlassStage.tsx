import type { ReactNode } from 'react';

interface GlassStageProps {
  children: ReactNode;
  screenName: string;
}

/**
 * KAN-74 Android TV performance fix.
 * The full-screen glass panel is deliberately static. Do not animate its
 * transform/opacity/filter: a TV WebView may repaint and blur the entire panel.
 * Small on-screen elements may still use transform/opacity animations.
 */
export function GlassStage({ children, screenName }: GlassStageProps) {
  return (
    <section className="tv-glass-stage" aria-label={screenName}>
      <div className="tv-glass-content">{children}</div>
    </section>
  );
}
