import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import DashboardPage from './DashboardPage';

setupMswServer();

const STATS = '*/api/v1/admin/stats';
const stats = (failed = 3) => ({
  generatedAt: '2026-11-04T10:15:30.000Z',
  certificates: { total: 12345, active: 12000, revoked: 345, issuedLast30Days: 77 },
  email: { pending: 5, sent: 1200, failed, skipped: 9 },
  templates: { total: 4 },
  organizations: { total: 2 },
  events: { total: 6 },
});

describe('DashboardPage', () => {
  it('shows a skeleton while loading, then the values as links, and passes axe', async () => {
    server.use(http.get(STATS, () => HttpResponse.json(stats())));
    const { container } = renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true');

    const total = await screen.findByRole('link', { name: /Total certificates\s+12,345/ });
    expect(total).toHaveAttribute('href', '/admin/certificates');
    expect(screen.getByRole('link', { name: /Active certificates\s+12,000/ })).toHaveAttribute(
      'href',
      '/admin/certificates?status=active',
    );
    expect(screen.getByRole('link', { name: /Revoked certificates\s+345/ })).toHaveAttribute(
      'href',
      '/admin/certificates?status=revoked',
    );
    expect(
      screen.getByRole('link', { name: /Issued in the last 30 days\s+77/ }).getAttribute('href'),
    ).toMatch(/^\/admin\/certificates\?issuedFrom=\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole('link', { name: /E-mail sent\s+1,200/ })).toHaveAttribute(
      'href',
      '/admin/certificates?emailStatus=sent',
    );
    expect(screen.getByRole('link', { name: /Organizations\s+2/ })).toHaveAttribute(
      'href',
      '/admin/organizations',
    );
    expect(screen.getByRole('link', { name: /Events\s+6/ })).toHaveAttribute(
      'href',
      '/admin/events',
    );
    expect(screen.getByRole('link', { name: /Templates\s+4/ })).toHaveAttribute(
      'href',
      '/admin/templates',
    );
    expect(screen.getByText(/Updated at/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Issue certificate' })).toHaveAttribute(
      'href',
      '/admin/certificates/new',
    );
    expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute('href', '/admin/import');
    expect(screen.getByRole('link', { name: 'Upload template' })).toHaveAttribute(
      'href',
      '/admin/templates/new',
    );
    await expectNoA11yViolations(container);
  });

  it('highlights failed e-mails only when there are some', async () => {
    server.use(http.get(STATS, () => HttpResponse.json(stats(3))));
    const first = renderWithProviders(<DashboardPage />);
    const failed = await screen.findByRole('link', { name: /E-mail failed\s+3/ });
    expect(failed).toHaveClass('border-danger');
    expect(screen.getByRole('link', { name: /E-mail sent/ })).not.toHaveClass('border-danger');
    first.unmount();

    server.use(http.get(STATS, () => HttpResponse.json(stats(0))));
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole('link', { name: /E-mail failed\s+0/ })).not.toHaveClass(
      'border-danger',
    );
  });

  it('refreshes with refresh=true and shows the throttle message on 429', async () => {
    const urls: string[] = [];
    server.use(
      http.get(STATS, ({ request }) => {
        urls.push(request.url);
        const refresh = new URL(request.url).searchParams.get('refresh');
        if (refresh === 'true' && urls.length > 2) {
          return HttpResponse.json(
            { error: { code: 'RATE_LIMITED', message: 'x', requestId: 'r' } },
            { status: 429, headers: { 'Retry-After': '9' } },
          );
        }
        return HttpResponse.json(refresh === 'true' ? stats(8) : stats(3));
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('link', { name: /E-mail failed\s+3/ });
    expect(urls).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('link', { name: /E-mail failed\s+8/ });
    expect(urls[1]).toContain('refresh=true');

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('wait about 10 seconds');
    expect(screen.getByRole('link', { name: /E-mail failed\s+8/ })).toBeInTheDocument();
  });

  it('shows an error state and retries', async () => {
    let calls = 0;
    server.use(
      http.get(STATS, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { error: { code: 'FORBIDDEN', message: 'x', requestId: 'req-1' } },
            { status: 403 },
          );
        }
        return HttpResponse.json(stats());
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/req-1/)).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Total certificates/ })).toBeInTheDocument(),
    );
  });
});
