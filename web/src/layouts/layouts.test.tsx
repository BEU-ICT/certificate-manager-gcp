import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { AdminLayout } from './AdminLayout';
import { PublicLayout } from './PublicLayout';

function renderAt(path: string, element: React.ReactNode) {
  const router = createMemoryRouter(
    [
      {
        element,
        children: [
          { path: '/', element: <h1>Home</h1> },
          { path: '/admin', element: <h1>Dash</h1> },
          { path: '/admin/events', element: <h1>Events page</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe('PublicLayout', () => {
  it('renders header, switcher slot, main and footer', async () => {
    const { container } = renderAt('/', <PublicLayout languageSwitcher={<button>AZ/EN</button>} />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AZ/EN' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Home' })).toBeVisible();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Contact');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('AdminLayout', () => {
  it('renders the nav, user email and sign-out', async () => {
    const onSignOut = vi.fn();
    const { container } = renderAt(
      '/admin/events',
      <AdminLayout userEmail="admin@example.org" onSignOut={onSignOut} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Dashboard', 'Organizations', 'Events', 'Templates', 'Certificates', 'Import']);
    expect(within(nav).getByRole('link', { name: 'Events' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByText('Signed in as admin@example.org')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledOnce();
    expect(screen.getByRole('main')).toHaveTextContent('Events page');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('toggles the mobile menu', async () => {
    renderAt('/admin', <AdminLayout />);
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
