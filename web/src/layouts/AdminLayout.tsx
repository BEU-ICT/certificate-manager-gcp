import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { Button } from '@/components';
import { cx } from '@/components/cx';
import { ADMIN_NAV } from './admin-nav';

export interface AdminLayoutProps {
  /** Signed-in user's email; provided by the auth layer (BEU-ICT/certificate-manager#292). */
  userEmail?: string | undefined;
  onSignOut?: () => void;
  /** Slot for the language switcher component supplied by the i18n task (BEU-ICT/certificate-manager#258). */
  languageSwitcher?: ReactNode;
}

/** Admin shell: top bar (user email, sign-out) and a side navigation that collapses below md. */
export function AdminLayout({ userEmail, onSignOut, languageSwitcher }: AdminLayoutProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        {t('layout.skipToContent')}
      </a>
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-4 py-2">
        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-control border border-line md:hidden"
          aria-expanded={menuOpen}
          aria-controls="admin-nav"
          aria-label={menuOpen ? t('layout.closeMenu') : t('layout.openMenu')}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span aria-hidden="true">{menuOpen ? '×' : '☰'}</span>
        </button>
        <span className="font-semibold">{t('app.name')}</span>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {languageSwitcher}
          {userEmail ? (
            <span className="max-w-full truncate text-sm text-ink-muted" title={userEmail}>
              {t('layout.admin.signedInAs', { email: userEmail })}
            </span>
          ) : null}
          <Button variant="secondary" onClick={onSignOut} disabled={!onSignOut}>
            {t('layout.admin.signOut')}
          </Button>
        </div>
      </header>
      <div className="flex min-w-0 flex-1">
        <nav
          id="admin-nav"
          aria-label={t('layout.admin.navLabel')}
          className={cx(
            'w-56 shrink-0 border-r border-line bg-surface p-3',
            menuOpen
              ? 'block max-md:absolute max-md:inset-x-0 max-md:z-20 max-md:shadow-overlay'
              : 'hidden',
            'md:block',
          )}
        >
          <ul className="flex flex-col gap-1">
            {ADMIN_NAV.map((item) => (
              <li key={item.key}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      'block rounded-control px-3 py-2 text-base font-medium',
                      isActive ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-surface-muted',
                    )
                  }
                >
                  {t(`layout.nav.${item.key}`)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
