import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import TemplatesPage from './TemplatesPage';

setupMswServer();

const LIST = '*/api/v1/admin/templates';
const ORGS = '*/api/v1/admin/organizations';
const EVENTS = '*/api/v1/admin/events';
const ts = '2026-11-04T10:15:30.000Z';
const TEMPLATE = (n: number, isLatest: boolean) => ({
  reference: `acme-devfest-attendance-v${n}`,
  organizationId: 'o1',
  organizationSlug: 'acme',
  eventId: 'e1',
  eventSlug: 'devfest',
  type: 'attendance',
  version: n,
  createdAt: ts,
  isLatest,
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
  http.get(ORGS, () =>
    HttpResponse.json({ items: [ORG('o1', 'Acme'), ORG('o2', 'Beta')], nextCursor: null }),
  ),
  http.get(EVENTS, ({ request }) => {
    const org = new URL(request.url).searchParams.get('organizationId');
    return HttpResponse.json({
      items: org === 'o1' ? [EVENT('e1', 'DevFest', 'o1')] : [EVENT('e2', 'Hack', 'o2')],
      nextCursor: null,
    });
  }),
];

function Location() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}

function renderPage(route = '/admin/templates') {
  return renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/admin/templates" element={<TemplatesPage />} />
      </Routes>
      <Location />
    </ToastProvider>,
    { route },
  );
}

describe('TemplatesPage', () => {
  it('lists versions with badges and passes axe', async () => {
    server.use(
      ...lookups(),
      http.get(LIST, () =>
        HttpResponse.json({ items: [TEMPLATE(2, true), TEMPLATE(1, false)], nextCursor: null }),
      ),
    );
    const { container } = renderPage();
    expect(await screen.findByRole('link', { name: 'acme-devfest-attendance-v2' })).toHaveAttribute(
      'href',
      '/admin/templates/acme-devfest-attendance-v2',
    );
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getAllByText('latest')).toHaveLength(1);
    expect(screen.getAllByRole('cell', { name: 'Attendance' })).toHaveLength(2);
    await expectNoA11yViolations(container);
  });

  it('shows the empty state with a call to action', async () => {
    server.use(
      ...lookups(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    renderPage();
    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload template' })).toHaveAttribute(
      'href',
      '/admin/templates/new',
    );
  });

  it('shows the error state and retries', async () => {
    let calls = 0;
    server.use(
      ...lookups(),
      http.get(LIST, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              { error: { code: 'INTERNAL', message: 'x', requestId: 'req-9' } },
              { status: 500 },
            )
          : HttpResponse.json({ items: [TEMPLATE(1, true)], nextCursor: null });
      }),
    );
    renderPage();
    expect(await screen.findByText(/req-9/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: 'acme-devfest-attendance-v1' })).toBeVisible();
  });

  it('keeps filters in the URL, requests with them and resets dependent selects', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      ...lookups(),
      http.get(LIST, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [TEMPLATE(1, true)], nextCursor: null });
      }),
    );
    renderPage();
    await screen.findByRole('link', { name: 'acme-devfest-attendance-v1' });
    const event = screen.getByLabelText('Event');
    expect(event).toBeDisabled();

    await userEvent.selectOptions(await screen.findByLabelText('Organization'), 'o1');
    await waitFor(() => expect(event).toBeEnabled());
    await userEvent.selectOptions(event, await screen.findByRole('option', { name: 'DevFest' }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'thanks');
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent(
        '/admin/templates?organizationId=o1&eventId=e1&type=thanks',
      ),
    );
    await waitFor(() => {
      const last = seen[seen.length - 1];
      expect(last?.get('organizationId')).toBe('o1');
      expect(last?.get('eventId')).toBe('e1');
      expect(last?.get('type')).toBe('thanks');
    });

    // Changing the organization clears the event but keeps the type.
    await userEvent.selectOptions(screen.getByLabelText('Organization'), 'o2');
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent(
        '/admin/templates?organizationId=o2&type=thanks',
      ),
    );
    expect(screen.getByLabelText('Event')).toHaveValue('');
  });

  it('reads filters from the URL and shows the filtered empty state', async () => {
    server.use(
      ...lookups(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    renderPage('/admin/templates?organizationId=o1&eventId=e1&type=team');
    expect(await screen.findByText('No templates match')).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toHaveValue('team');
    expect(screen.getByLabelText('Organization')).toHaveValue('o1');
  });

  it('paginates with the cursor', async () => {
    server.use(
      ...lookups(),
      http.get(LIST, ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'c2'
          ? HttpResponse.json({ items: [TEMPLATE(1, false)], nextCursor: null })
          : HttpResponse.json({ items: [TEMPLATE(2, true)], nextCursor: 'c2' }),
      ),
    );
    renderPage();
    await screen.findByRole('link', { name: 'acme-devfest-attendance-v2' });
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByRole('link', { name: 'acme-devfest-attendance-v1' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(await screen.findByRole('link', { name: 'acme-devfest-attendance-v2' })).toBeVisible();
  });
});
