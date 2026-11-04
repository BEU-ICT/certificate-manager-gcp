import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:bg-danger-hover border border-transparent',
  ghost: 'bg-transparent text-primary border border-transparent hover:bg-primary-soft',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a spinner and blocks interaction while keeping the button focusable-state consistent. */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  type = 'button',
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 py-2 text-base ' +
          'font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
