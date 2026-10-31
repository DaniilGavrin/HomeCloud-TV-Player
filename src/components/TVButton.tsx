import type { ReactNode } from 'react';
import { motion } from 'motion/react';

interface TVButtonProps {
  children: ReactNode;
  kind?: 'primary' | 'secondary';
  className?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  autoFocus?: boolean;
}

export function TVButton({
  children, kind = 'secondary', className = '', onClick,
  type = 'button', disabled = false, autoFocus = false,
}: TVButtonProps) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      whileHover={disabled ? undefined : { scale: 1.018 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 330, damping: 24 }}
      className={`tv-button tv-button--${kind} ${className}`}
    >
      {children}
    </motion.button>
  );
}
