import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router-dom';

export interface PublicLayoutProps {
  /** Slot for the language switcher component supplied by the i18n task (#39). */
  languageSwitcher?: ReactNode;
}

/** Public-facing shell: minimal header (logo placeholder + language switcher) and a footer. */
export function PublicLayout({ languageSwitcher }: PublicLayoutProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        {t('layout.skipToContent')}
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 rounded-control font-semibold">
            <span
              aria-hidden="true"
              className="inline-flex size-9 items-center justify-center rounded-control bg-primary text-sm text-white"
            >
              {t('layout.logo').slice(0, 1)}
            </span>
            <span>{t('app.name')}</span>
          </Link>
          {languageSwitcher ? <div>{languageSwitcher}</div> : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface-muted">
        <p className="mx-auto max-w-5xl px-4 py-4 text-sm text-ink-muted">
          {t('layout.footer.contact')}
        </p>
      </footer>
    </div>
  );
}
