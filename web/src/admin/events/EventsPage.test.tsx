import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import EventsPage from './EventsPage';

setupMswServer();

const LIST = '*/api/v1/admin/events';
const ORGS = '*/api/v1/admin/organizations';
const EVENT = (id: string, name: string, slug: string, org = 'o1', lang = 'az') => ({
  id,
  organizationId: org,
  organizationName: org === 'o1' ? 'Acme' : 'Beta',
  name,
  slug,
  emailLanguage: lang,
  createdAt: '2026-11-04T10:15:30.000Z',
  updatedAt: '2026-11-04T10:15:30.000Z',
});
const ORG = (id: string, name: string) => ({
  id,
  name,
  slug: name.toLowerCase(),
  createdAt: '2026-11-04T10:15:30.000Z',
  updatedAt: '2026-11-04T10:15:30.000Z',
});
const error = (status: number, code: string, details?: unknown[]) =>
  HttpResponse.json({ error: { code, message: 'x', requestId: 'req-42', details } }, { status });
const orgsHandler = () =>
  http.get(ORGS, () =>
    HttpResponse.json({ items: [ORG('o1', 'Acme'), ORG('o2', 'Beta')], nextCursor: null }),
  );
const listOne = () =>
  http.get(LIST, () =>
    HttpResponse.json({ items: [EVENT('e1', 'DevFest', 'devfest-2026')], nextCursor: null }),
  );

function Location() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}

function renderPage(route = '/admin/events') {
  return renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/admin/events" element={<EventsPage />} />
      </Routes>
      <Location />
    </ToastProvider>,
    { route },
  );
}

describe('EventsPage list', () => {
  it('shows a skeleton, then the table, and passes axe', async () => {
    server.use(orgsHandler(), listOne());
    const { container } = renderPage();
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('cell', { name: 'DevFest' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'devfest-2026' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Azərbaycan dili' })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('shows the empty state with a create action', async () => {
    server.use(
      orgsHandler(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    renderPage();
    expect(await screen.findByText('No events yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New event' })).toBeInTheDocument();
  });

  it('shows the error state with the request id and retries', async () => {
    let calls = 0;
    server.use(
      orgsHandler(),
      http.get(LIST, () => {
        calls += 1;
        return calls === 1
          ? error(500, 'INTERNAL')
          : HttpResponse.json({
              items: [EVENT('e1', 'DevFest', 'devfest-2026')],
              nextCursor: null,
            });
      }),
    );
    renderPage();
    expect(await screen.findByText(/req-42/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('cell', { name: 'DevFest' })).toBeInTheDocument();
  });

  it('paginates with the cursor and switches the page size', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      orgsHandler(),
      http.get(LIST, ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.push(params);
        return params.get('cursor') === 'c2'
          ? HttpResponse.json({ items: [EVENT('e2', 'Hack', 'hack')], nextCursor: null })
          : HttpResponse.json({
              items: [EVENT('e1', 'DevFest', 'devfest-2026')],
              nextCursor: 'c2',
            });
      }),
    );
    renderPage();
    await screen.findByRole('cell', { name: 'DevFest' });
    expect(seen[0]?.get('limit')).toBe('25');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByRole('cell', { name: 'Hack' })).toBeInTheDocument();
    expect(seen.at(-1)?.get('cursor')).toBe('c2');
    await userEvent.click(screen.getByRole('button', { name: /previous/i }));
    await screen.findByRole('cell', { name: 'DevFest' });
    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '50');
    await waitFor(() => expect(seen.at(-1)?.get('limit')).toBe('50'));
    expect(seen.at(-1)?.get('cursor')).toBeNull();
  });
});

describe('organization filter', () => {
  it('filters by organization, keeps it in the URL and resets the cursor', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      orgsHandler(),
      http.get(LIST, ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.push(params);
        return params.get('organizationId') === 'o2'
          ? HttpResponse.json({ items: [EVENT('e2', 'Hack', 'hack', 'o2')], nextCursor: null })
          : HttpResponse.json({
              items: [EVENT('e1', 'DevFest', 'devfest-2026')],
              nextCursor: 'c2',
            });
      }),
    );
    renderPage();
    await screen.findByRole('cell', { name: 'DevFest' });
    expect(seen[0]?.get('organizationId')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Filter by organization' }),
      'Beta',
    );
    expect(await screen.findByRole('cell', { name: 'Hack' })).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/events?organizationId=o2');
    expect(seen.at(-1)?.get('organizationId')).toBe('o2');
    expect(seen.at(-1)?.get('cursor')).toBeNull();
  });

  it('applies the filter from the URL and offers to clear it', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      orgsHandler(),
      http.get(LIST, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderPage('/admin/events?organizationId=o2');
    expect(await screen.findByText('This organization has no events')).toBeInTheDocument();
    expect(seen[0]?.get('organizationId')).toBe('o2');
    const select = await screen.findByRole('combobox', { name: 'Filter by organization' });
    await waitFor(() => expect(select).toHaveValue('o2'));
    await userEvent.selectOptions(select, 'All organizations');
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/admin/events'));
    expect(screen.getByTestId('loc').textContent).not.toContain('organizationId');
  });

  it('loads more organizations in pages of 50', async () => {
    const seen: (string | null)[] = [];
    server.use(
      listOne(),
      http.get(ORGS, ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.push(params.get('cursor'));
        expect(params.get('limit')).toBe('50');
        return params.get('cursor') === 'oc2'
          ? HttpResponse.json({ items: [ORG('o51', 'Zeta')], nextCursor: null })
          : HttpResponse.json({
              items: Array.from({ length: 50 }, (_, i) => ORG(`o${i}`, `Org ${i}`)),
              nextCursor: 'oc2',
            });
      }),
    );
    renderPage();
    await screen.findByRole('cell', { name: 'DevFest' });
    const select = screen.getByRole('combobox', { name: 'Filter by organization' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(51));
    expect(within(select).queryByRole('option', { name: 'Zeta' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more organizations' }));
    expect(await within(select).findByRole('option', { name: 'Zeta' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Load more organizations' }),
    ).not.toBeInTheDocument();
    expect(seen).toEqual([null, 'oc2']);
  });
});

describe('create dialog', () => {
  async function openCreate() {
    await userEvent.click((await screen.findAllByRole('button', { name: 'New event' }))[0]!);
    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(
        within(within(dialog).getByLabelText(/^Organization/)).getAllByRole('option').length,
      ).toBe(3),
    );
    return dialog;
  }

  it('creates an event with organization, suggested slug and language az by default', async () => {
    let body: unknown;
    server.use(
      orgsHandler(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post(LIST, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(EVENT('e1', 'DevFest 2026', 'devfest-2026'), { status: 201 });
      }),
    );
    renderPage();
    const dialog = await openCreate();
    await expectNoA11yViolations(dialog);
    expect(within(dialog).getByLabelText(/^E-mail language/)).toHaveValue('az');
    expect(within(dialog).getByText(/include the year, e\.g\. devfest-2026/)).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Organization/), 'Acme');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'DevFest 2026');
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveValue('devfest-2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Event "DevFest 2026" created')).toBeInTheDocument();
    expect(body).toEqual({
      organizationId: 'o1',
      name: 'DevFest 2026',
      slug: 'devfest-2026',
      emailLanguage: 'az',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends the chosen e-mail language', async () => {
    let body: { emailLanguage?: string } = {};
    server.use(
      orgsHandler(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post(LIST, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(EVENT('e1', 'Hack', 'hack', 'o1', 'en'), { status: 201 });
      }),
    );
    renderPage();
    const dialog = await openCreate();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Organization/), 'Beta');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Hack');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^E-mail language/), 'English');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(body.emailLanguage).toBe('en'));
  });

  it('preselects the filtered organization', async () => {
    server.use(
      orgsHandler(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    renderPage('/admin/events?organizationId=o2');
    const dialog = await openCreate();
    expect(within(dialog).getByLabelText(/^Organization/)).toHaveValue('o2');
  });

  it('validates required organization, name and slug without calling the API', async () => {
    let posted = false;
    server.use(
      orgsHandler(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post(LIST, () => {
        posted = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderPage();
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^Organization/)).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(within(dialog).getByText('Enter a name')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a slug')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('offers the suggestion on SLUG_TAKEN and resubmits with it', async () => {
    const bodies: { slug: string }[] = [];
    server.use(
      orgsHandler(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post(LIST, async ({ request }) => {
        const body = (await request.json()) as { slug: string };
        bodies.push(body);
        return body.slug === 'devfest-2026'
          ? error(409, 'CONFLICT', [
              { path: 'slug', message: 'SLUG_TAKEN', suggestion: 'devfest-2026-2' },
            ])
          : HttpResponse.json(EVENT('e1', 'DevFest 2026', body.slug), { status: 201 });
      }),
    );
    renderPage();
    const dialog = await openCreate();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Organization/), 'Acme');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'DevFest 2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(
      await within(dialog).findByText('This slug is already taken in this organization'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use "devfest-2026-2"?' }));
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveValue('devfest-2026-2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Event "DevFest 2026" created')).toBeInTheDocument();
    expect(bodies.map((b) => b.slug)).toEqual(['devfest-2026', 'devfest-2026-2']);
  });

  it('shows a deleted organization as a field error', async () => {
    server.use(
      orgsHandler(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post(LIST, () => error(404, 'NOT_FOUND', [{ path: 'organizationId', message: 'x' }])),
    );
    renderPage();
    const dialog = await openCreate();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Organization/), 'Acme');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Hack');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(
      await within(dialog).findByText('This organization no longer exists'),
    ).toBeInTheDocument();
  });

  it('closes on Escape without creating', async () => {
    server.use(
      orgsHandler(),
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    renderPage();
    await openCreate();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('edit and delete', () => {
  it('edits name and language; slug and organization are read-only', async () => {
    let body: unknown;
    server.use(
      orgsHandler(),
      listOne(),
      http.patch(`${LIST}/e1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(EVENT('e1', 'DevFest EN', 'devfest-2026', 'o1', 'en'));
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit DevFest' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText(/^Organization/)).toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText(/^Organization/)).toHaveValue('Acme');
    await expectNoA11yViolations(dialog);
    const name = within(dialog).getByLabelText(/^Name/);
    await userEvent.clear(name);
    await userEvent.type(name, 'DevFest EN');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^E-mail language/), 'English');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Event "DevFest EN" updated')).toBeInTheDocument();
    expect(body).toEqual({ name: 'DevFest EN', emailLanguage: 'en' });
  });

  it('deletes after confirmation and refreshes the list', async () => {
    let deleted = false;
    server.use(
      orgsHandler(),
      http.get(LIST, () =>
        HttpResponse.json({
          items: deleted ? [] : [EVENT('e1', 'DevFest', 'devfest-2026')],
          nextCursor: null,
        }),
      ),
      http.delete(`${LIST}/e1`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete DevFest' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Event "DevFest" deleted')).toBeInTheDocument();
    expect(await screen.findByText('No events yet')).toBeInTheDocument();
  });

  it('explains a 409 IN_USE with the counts and keeps the event', async () => {
    server.use(
      orgsHandler(),
      listOne(),
      http.delete(`${LIST}/e1`, () =>
        error(409, 'CONFLICT', [
          { path: 'references', message: 'IN_USE', counts: { templates: 1, certificates: 30 } },
        ]),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete DevFest' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByText('1 template')).toBeInTheDocument();
    expect(within(dialog).getByText('30 certificates')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await expectNoA11yViolations(dialog);
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(screen.getByRole('cell', { name: 'DevFest' })).toBeInTheDocument();
  });
});
