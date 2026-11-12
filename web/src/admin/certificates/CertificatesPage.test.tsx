import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import CertificatesPage from './CertificatesPage';

setupMswServer();

const LIST = '*/api/v1/admin/certificates';
const COUNT = '*/api/v1/admin/certificates/count';
const ORGS = '*/api/v1/admin/organizations';
const EVENTS = '*/api/v1/admin/events';
const ts = '2026-11-04T10:15:30.000Z';
const CERT = (id: string, owner: string, extra: object = {}) => ({
  id,
  ownerName: owner,
  eventName: 'DevFest',
  organizationName: 'Acme',
  type: 'attendance',
  subject: 'Attended DevFest',
  issuedAt: ts,
  status: 'active',
  emailStatus: 'sent',
  hasEmail: true,
  ...extra,
});
const ORG = (id: string, name: string) => ({
  id,
  name,
  slug: name.toLowerCase(),
  createdAt: ts,
  updatedAt: ts,
});
const EVENT = (id: string, name: string, org: string) => ({
  id,
  organizationId: org,
  organizationName: 'x',
  name,
  slug: name.toLowerCase(),
  emailLanguage: 'az',
  createdAt: ts,
  updatedAt: ts,
});
const lookups = () => [
  http.get(ORGS, () => HttpResponse.json({ items: [ORG('o1', 'Acme')], nextCursor: null })),
  http.get(EVENTS, () =>
    HttpResponse.json({ items: [EVENT('e1', 'DevFest', 'o1')], nextCursor: null }),
  ),
];
const count = (n = 2) => http.get(COUNT, () => HttpResponse.json({ count: n }));

function Location() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}

function renderPage(route = '/admin/certificates') {
  return renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/admin/certificates" element={<CertificatesPage />} />
      </Routes>
      <Location />
    </ToastProvider>,
    { route },
  );
}

describe('CertificatesPage', () => {
  it('lists certificates with badges, count and quick links, and passes axe', async () => {
    server.use(
      ...lookups(),
      count(2),
      http.get(LIST, () =>
        HttpResponse.json({
          items: [
            CERT('c1', 'Aysel'),
            CERT('c2', 'Kamran', { status: 'revoked', emailStatus: 'failed' }),
          ],
          nextCursor: null,
        }),
      ),
    );
    const { container } = renderPage();
    // The first render of a cold worker can exceed the default 1 s.
    expect(await screen.findByRole('link', { name: 'Aysel' }, { timeout: 5000 })).toHaveAttribute(
      'href',
      '/admin/certificates/c1',
    );
    expect(await screen.findByText('Total: 2')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Revoked' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Failed' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('columnheader').every((h) => h.getAttribute('scope') === 'col'),
    ).toBe(true);
    expect(screen.getByRole('link', { name: 'Issue certificate' })).toHaveAttribute(
      'href',
      '/admin/certificates/new',
    );
    expect(screen.getByRole('link', { name: 'Import from file' })).toHaveAttribute(
      'href',
      '/admin/certificates/import',
    );
    await expectNoA11yViolations(container);
  });

  it('opens the detail on row click', async () => {
    server.use(
      ...lookups(),
      count(1),
      http.get(LIST, () => HttpResponse.json({ items: [CERT('c1', 'Aysel')], nextCursor: null })),
    );
    renderPage();
    await userEvent.click(await screen.findByText('Attended DevFest'));
    // The page has no detail route in this test: navigation is visible in the location.
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/certificates/c1');
  });

  it('syncs filters with the URL, requests with them and clears them', async () => {
    const seen: URLSearchParams[] = [];
    const counts: URLSearchParams[] = [];
    server.use(
      ...lookups(),
      http.get(COUNT, ({ request }) => {
        counts.push(new URL(request.url).searchParams);
        return HttpResponse.json({ count: 1 });
      }),
      http.get(LIST, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [CERT('c1', 'Aysel')], nextCursor: null });
      }),
    );
    renderPage();
    await screen.findByRole('link', { name: 'Aysel' });
    const event = screen.getByLabelText('Event');
    expect(event).toBeDisabled();
    await userEvent.selectOptions(await screen.findByLabelText('Organization'), 'o1');
    await waitFor(() => expect(event).toBeEnabled());
    await userEvent.selectOptions(event, await screen.findByRole('option', { name: 'DevFest' }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'thanks');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'revoked');
    await userEvent.type(screen.getByLabelText('Issued from'), '2026-01-01');
    await userEvent.type(screen.getByLabelText('Issued to'), '2026-02-01');
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent(
        '/admin/certificates?organizationId=o1&eventId=e1&type=thanks&status=revoked&issuedFrom=2026-01-01&issuedTo=2026-02-01',
      ),
    );
    await waitFor(() => {
      const last = seen[seen.length - 1];
      expect(last?.get('eventId')).toBe('e1');
      expect(last?.get('issuedTo')).toBe('2026-02-01');
      expect(last?.get('limit')).toBe('25');
    });
    expect(counts[counts.length - 1]?.get('status')).toBe('revoked');
    expect(counts[counts.length - 1]?.has('limit')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent(/^\/admin\/certificates$/),
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('restores filters from the URL', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      ...lookups(),
      count(),
      http.get(LIST, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [CERT('c1', 'Aysel')], nextCursor: null });
      }),
    );
    renderPage('/admin/certificates?organizationId=o1&status=active&issuedFrom=2026-01-01');
    await screen.findByRole('link', { name: 'Aysel' });
    expect(screen.getByLabelText('Status')).toHaveValue('active');
    expect(screen.getByLabelText('Issued from')).toHaveValue('2026-01-01');
    expect(seen[0]?.get('organizationId')).toBe('o1');
  });

  it('pages forward and back with a cursor stack and page size', async () => {
    const cursors: (string | null)[] = [];
    const limits: (string | null)[] = [];
    let counted = 0;
    server.use(
      ...lookups(),
      http.get(COUNT, () => {
        counted += 1;
        return HttpResponse.json({ count: 3 });
      }),
      http.get(LIST, ({ request }) => {
        const p = new URL(request.url).searchParams;
        cursors.push(p.get('cursor'));
        limits.push(p.get('limit'));
        const c = p.get('cursor');
        if (c === null)
          return HttpResponse.json({ items: [CERT('c1', 'First')], nextCursor: 'k1' });
        if (c === 'k1')
          return HttpResponse.json({ items: [CERT('c2', 'Second')], nextCursor: 'k2' });
        return HttpResponse.json({ items: [CERT('c3', 'Third')], nextCursor: null });
      }),
    );
    renderPage();
    await screen.findByRole('link', { name: 'First' });
    const next = screen.getByRole('button', { name: /next/i });
    const prev = screen.getByRole('button', { name: /previous/i });
    expect(prev).toBeDisabled();
    await userEvent.click(next);
    await screen.findByRole('link', { name: 'Second' });
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await screen.findByRole('link', { name: 'Third' });
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /previous/i }));
    await screen.findByRole('link', { name: 'Second' });
    await userEvent.click(screen.getByRole('button', { name: /previous/i }));
    await screen.findByRole('link', { name: 'First' });
    expect(cursors.slice(0, 3)).toEqual([null, 'k1', 'k2']);
    expect(counted).toBe(1);

    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '50');
    await waitFor(() => expect(limits).toContain('50'));
  });

  it('keeps the list when the count fails', async () => {
    server.use(
      ...lookups(),
      http.get(COUNT, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } },
          { status: 500 },
        ),
      ),
      http.get(LIST, () => HttpResponse.json({ items: [CERT('c1', 'Aysel')], nextCursor: null })),
    );
    renderPage();
    expect(await screen.findByRole('link', { name: 'Aysel' })).toBeVisible();
    expect(await screen.findByText('Total: unavailable')).toBeInTheDocument();
  });

  it('shows the empty state, and the filtered empty state clears filters', async () => {
    server.use(
      ...lookups(),
      count(0),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    const first = renderPage();
    expect(await screen.findByText('No certificates yet')).toBeInTheDocument();
    first.unmount();

    renderPage('/admin/certificates?status=revoked');
    expect(await screen.findByText('No certificates match')).toBeInTheDocument();
    const clear = screen.getAllByRole('button', { name: 'Clear filters' });
    await userEvent.click(clear[clear.length - 1]!);
    expect(await screen.findByText('No certificates yet')).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/admin\/certificates$/);
  });

  it('shows the error state with the request id and retries', async () => {
    let calls = 0;
    server.use(
      ...lookups(),
      count(1),
      http.get(LIST, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              { error: { code: 'INTERNAL', message: 'x', requestId: 'req-9' } },
              { status: 500 },
            )
          : HttpResponse.json({ items: [CERT('c1', 'Aysel')], nextCursor: null });
      }),
    );
    renderPage();
    expect(await screen.findByText(/req-9/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: 'Aysel' })).toBeVisible();
  });

  it('aborts the superseded request when a filter changes quickly', async () => {
    const signals: AbortSignal[] = [];
    server.use(
      ...lookups(),
      count(),
      http.get(LIST, async ({ request }) => {
        signals.push(request.signal);
        if (new URL(request.url).searchParams.get('status') === null) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return HttpResponse.json({ items: [CERT('c1', 'Aysel')], nextCursor: null });
      }),
    );
    renderPage();
    await waitFor(() => expect(signals).toHaveLength(1));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'revoked');
    await waitFor(() => expect(signals).toHaveLength(2));
    await waitFor(() => expect(signals[0]?.aborted).toBe(true));
    expect(await screen.findByRole('link', { name: 'Aysel' })).toBeVisible();
  });

  it('filters by email status in the URL and shows an icon with each status badge', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      ...lookups(),
      count(4),
      http.get(LIST, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          items: (['pending', 'sent', 'failed', 'skipped'] as const).map((emailStatus) =>
            CERT(emailStatus, `Owner ${emailStatus}`, { emailStatus }),
          ),
          nextCursor: null,
        });
      }),
    );
    renderPage('/admin/certificates?emailStatus=failed');
    await screen.findByRole('link', { name: 'Owner sent' }, { timeout: 5000 });
    expect(screen.getByLabelText('Email status')).toHaveValue('failed');
    expect(seen[0]?.get('emailStatus')).toBe('failed');
    for (const label of ['Pending', 'Sent', 'Failed', 'Skipped']) {
      const badge = screen.getByRole('cell', { name: label });
      expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    await userEvent.selectOptions(screen.getByLabelText('Email status'), 'pending');
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent(
        '/admin/certificates?emailStatus=pending',
      ),
    );
    await waitFor(() => expect(seen[seen.length - 1]?.get('emailStatus')).toBe('pending'));
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent(/^\/admin\/certificates$/),
    );
  });

  it('ignores an unknown email status in the URL', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      ...lookups(),
      count(),
      http.get(LIST, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [CERT('c1', 'Aysel')], nextCursor: null });
      }),
    );
    renderPage('/admin/certificates?emailStatus=bogus');
    await screen.findByRole('link', { name: 'Aysel' }, { timeout: 5000 });
    expect(seen[0]?.has('emailStatus')).toBe(false);
  });
});
