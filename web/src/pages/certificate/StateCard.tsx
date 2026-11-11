import type { ReactNode } from 'react';

/** Page-level message (not found, rate limited, error). Owns the page's single `h1`. */
export function StateCard({
  title,
  children,
  tone = 'neutral',
}: {
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <section
      className={`rounded-card border px-4 py-8 text-center sm:px-8 ${
        tone === 'danger' ? 'border-danger bg-danger-soft' : 'border-line bg-surface-muted'
      }`}
    >
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <div className="mt-3 flex flex-col items-center gap-3 text-base text-ink">{children}</div>
    </section>
  );
}
