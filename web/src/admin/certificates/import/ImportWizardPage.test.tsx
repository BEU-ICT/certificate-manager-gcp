import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ToastProvider } from '@/components';
import i18n from '@/i18n';
import { expectNoA11yViolations } from '@/test/axe';
import { createTestQueryClient } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import { runnerTuning } from './bulk-runner';
import ImportWizardPage from './ImportWizardPage';

setupMswServer();
beforeAll(() => {
  runnerTuning.networkBackoffMs = 0;
});
afterEach(() => {
  localStorage.clear();
});

const ts = '2026-11-04T10:15:30.000Z';
type User = ReturnType<typeof userEvent.setup>;

interface Post {
  items: Record<string, unknown>[];
  body: Record<string, unknown>;
  key: string | null;
}

function lookups() {
  server.use(
    http.get('*/api/v1/admin/organizations', () =>
      HttpResponse.json({
        items: [{ id: 'o1', name: 'Acme', slug: 'acme', createdAt: ts, updatedAt: ts }],
        nextCursor: null,
      }),
    ),
    http.get('*/api/v1/admin/events', ({ request }) =>
      HttpResponse.json({
        items:
          new URL(request.url).searchParams.get('organizationId') === 'o1'
            ? [
                {
                  id: 'e1',
                  organizationId: 'o1',
                  organizationName: 'Acme',
                  name: 'DevFest',
                  slug: 'devfest',
                  emailLanguage: 'az',
                  createdAt: ts,
                  updatedAt: ts,
                },
              ]
            : [],
        nextCursor: null,
      }),
    ),
    http.get('*/api/v1/admin/templates', () =>
      HttpResponse.json({
        items: [
          {
            reference: 'acme-devfest-attendance-v1',
            version: 1,
            isLatest: true,
            organizationId: 'o1',
            organizationSlug: 'acme',
            eventId: 'e1',
            eventSlug: 'devfest',
            type: 'attendance',
            createdAt: ts,
          },
        ],
        nextCursor: null,
      }),
    ),
  );
}

type Responder = (post: Post, call: number) => Response | Promise<Response>;

/** Answers the bulk endpoint with `respond` (default: 201 echoing the items) and records every request. */
function bulk(respond?: Responder): Post[] {
  const posts: Post[] = [];
  server.use(
    http.post('*/api/v1/admin/certificates/bulk', async ({ request }) => {
      const body = (await request.json()) as { items: Record<string, unknown>[] };
      const post: Post = {
        items: body.items,
        body: body,
        key: request.headers.get('Idempotency-Key'),
      };
      posts.push(post);
      return respond ? respond(post, posts.length) : created(post);
    }),
  );
  return posts;
}

function created(post: Post, headers?: HeadersInit): Response {
  return HttpResponse.json(
    {
      created: post.items.length,
      items: post.items.map((i, n) => ({
        id: `id${String(n)}`,
        ownerName: i['ownerName'],
        hasEmail: i['email'] !== undefined,
      })),
    },
    { status: 201, ...(headers ? { headers } : {}) },
  );
}

const errorBody = (status: number, code: string, details?: unknown, headers?: HeadersInit) =>
  HttpResponse.json(
    { error: { code, message: 'Failed', ...(details ? { details } : {}) } },
    { status, ...(headers ? { headers } : {}) },
  );

function Location() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/admin/certificates/import', element: <ImportWizardPage /> },
      { path: '/admin/certificates', element: <Location /> },
      { path: '/admin/other', element: <Location /> },
    ],
    { initialEntries: ['/admin/certificates/import'] },
  );
  const result = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { router, ...result };
}

function csv(count: number, extra: (n: number) => string[] = () => []): string {
  const lines = ['Full name,Email,Subject,Skills,Date'];
  for (let n = 1; n <= count; n++) {
    const [email = `p${String(n)}@example.com`, date = '2026-01-02'] = extra(n);
    lines.push(`Person ${String(n)},${email},,,${date}`);
  }
  return lines.join('\n');
}

async function toPreview(user: User, text: string, subject = 'Attended DevFest') {
  await screen.findByRole('option', { name: 'Acme' }, { timeout: 5000 });
  await user.selectOptions(screen.getByLabelText(/Organization/), 'o1');
  await screen.findByRole('option', { name: 'DevFest' });
  await user.selectOptions(screen.getByLabelText(/^Event/), 'e1');
  await user.selectOptions(screen.getByLabelText(/^Type/), 'attendance');
  if (subject) await user.type(screen.getByLabelText(/^Common subject/), subject);
  await user.upload(
    screen.getByLabelText(/Spreadsheet file/),
    new File([text], 'people.csv', { type: 'text/csv', lastModified: 1_700_000_000_000 }),
  );
  await user.click(screen.getByRole('button', { name: 'Continue to preview' }));
  await screen.findByRole('button', { name: /^Import \d+ certificates$/ });
}

const startButton = () => screen.getByRole('button', { name: /^Import \d+ certificates$/ });

describe('ImportWizardPage', () => {
  it('imports 1200 rows as chunks of 500, 500 and 200 with distinct idempotency keys', async () => {
    lookups();
    const posts = bulk();
    const user = userEvent.setup();
    const { container } = renderPage();
    await toPreview(user, csv(1200));

    expect(screen.getByRole('button', { name: 'Import 1200 certificates' })).toBeInTheDocument();
    const counts = screen.getByRole('group', { name: 'Summary of the file' });
    expect(within(counts).getAllByText('1,200').length).toBeGreaterThanOrEqual(3);
    // Virtualised: far fewer rows in the DOM than in the file.
    expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBeLessThan(80);
    await expectNoA11yViolations(container);

    await user.click(startButton());
    expect(await screen.findByText(/Created certificates: 1,200/)).toBeInTheDocument();
    expect(posts.map((p) => p.items.length)).toEqual([500, 500, 200]);
    expect(posts[0]?.body).toMatchObject({
      organizationId: 'o1',
      eventId: 'e1',
      type: 'attendance',
      subject: 'Attended DevFest',
    });
    expect(posts[0]?.items[0]).toEqual({
      ownerName: 'Person 1',
      email: 'p1@example.com',
      issuedAt: '2026-01-02T12:00:00.000Z',
    });
    const keys = posts.map((p) => p.key);
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(screen.getByText(/E-mails queued: 1,200/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View imported certificates' });
    expect(link).toHaveAttribute(
      'href',
      '/admin/certificates?organizationId=o1&eventId=e1&issuedFrom=2026-01-02&issuedTo=2026-01-02',
    );
    // The preview is gone and nothing was stored in the browser.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Person 1')).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    await expectNoA11yViolations(container);
  });

  it('resumes after a failed chunk 2 and sends only chunks 2 and 3', async () => {
    lookups();
    const posts = bulk((post, call) => (call === 2 ? errorBody(403, 'FORBIDDEN') : created(post)));
    const user = userEvent.setup();
    renderPage();
    await toPreview(user, csv(1200));
    await user.click(startButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission');
    expect(posts).toHaveLength(2);
    expect(screen.getByText('Part 1 (500 rows)').parentElement).toHaveTextContent('Done');
    expect(screen.getByText('Part 2 (500 rows)').parentElement).toHaveTextContent('Failed');

    await user.click(screen.getByRole('button', { name: 'Resume import' }));
    expect(await screen.findByText(/Created certificates: 1,200/)).toBeInTheDocument();
    expect(posts.map((p) => p.items.length)).toEqual([500, 500, 500, 200]);
    // Chunk 1 was not sent again: the retry of chunk 2 reuses its key, chunk 3 has a new one.
    expect(posts[2]?.key).toBe(posts[1]?.key);
    expect(posts[3]?.key).not.toBe(posts[1]?.key);
    expect(posts[2]?.items[0]?.['ownerName']).toBe('Person 501');
  });

  it('maps BULK_INVALID details to the sheet rows and resumes without the excluded row', async () => {
    lookups();
    const posts = bulk((post, call) =>
      call === 2
        ? errorBody(422, 'BULK_INVALID', [
            {
              path: 'items[17].ownerName',
              message: 'Name does not fit',
              code: 'TEXT_DOES_NOT_FIT',
            },
          ])
        : created(post),
    );
    const user = userEvent.setup();
    renderPage();
    await toPreview(user, csv(600));
    await user.click(startButton());
    // Chunk 2 starts at sheet row 502; item 17 is row 502 + 17 = 519.
    const exclude = await screen.findByRole('checkbox', { name: /Exclude row 519 \(Person 518\)/ });
    expect(screen.getByText(/Name does not fit/)).toBeInTheDocument();
    await user.click(exclude);
    await user.click(screen.getByRole('button', { name: 'Resume import' }));
    expect(await screen.findByText(/Created certificates: 599/)).toBeInTheDocument();
    expect(posts.map((p) => p.items.length)).toEqual([500, 100, 99]);
    expect(posts[2]?.items.some((i) => i['ownerName'] === 'Person 518')).toBe(false);
    expect(posts[2]?.key).not.toBe(posts[1]?.key);
  });

  it('does not send excluded or invalid rows', async () => {
    lookups();
    const posts = bulk();
    const user = userEvent.setup();
    renderPage();
    await toPreview(
      user,
      csv(5, (n) => (n === 4 ? ['not-an-email'] : [])),
    );
    expect(screen.getByRole('button', { name: 'Import 4 certificates' })).toBeInTheDocument();
    expect(screen.getByText('Invalid value.')).toBeInTheDocument();
    const invalidBox = screen.getByRole('checkbox', { name: 'Import row 5' });
    expect(invalidBox).not.toBeChecked();
    expect(invalidBox).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Import row 3' }));
    expect(screen.getByRole('button', { name: 'Import 3 certificates' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Show errors only' }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    await user.click(screen.getByRole('checkbox', { name: 'Show errors only' }));
    await user.click(startButton());
    expect(await screen.findByText(/Created certificates: 3/)).toBeInTheDocument();
    expect(posts[0]?.items.map((i) => i['ownerName'])).toEqual([
      'Person 1',
      'Person 3',
      'Person 5',
    ]);
  });

  it('marks rows without a subject invalid when there is no common subject', async () => {
    lookups();
    const user = userEvent.setup();
    renderPage();
    await toPreview(
      user,
      'Full name,Email,Date\nAnna,a@example.com,2026-01-02\nBob,b@example.com,2026-01-02',
      '',
    );
    expect(screen.getAllByText('Required (or enter a common subject).')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Import 0 certificates' })).toBeInTheDocument();
  });

  it('shows a replayed chunk as already created', async () => {
    lookups();
    bulk((post) => created(post, { 'Idempotent-Replayed': 'true' }));
    const user = userEvent.setup();
    renderPage();
    await toPreview(user, csv(3));
    await user.click(startButton());
    await screen.findByText(/Created certificates: 3/);
  });

  it('shows the replayed state while a chunk of a longer import finishes', async () => {
    lookups();
    bulk((post, call) =>
      call === 1
        ? created(post, { 'Idempotent-Replayed': 'true' })
        : delay('infinite').then(() => created(post)),
    );
    const user = userEvent.setup();
    renderPage();
    await toPreview(user, csv(600));
    await user.click(startButton());
    const part = await screen.findByText('Part 1 (500 rows)');
    await waitFor(() => expect(part.parentElement).toHaveTextContent('already created earlier'));
  });

  it('waits for Retry-After on 429 and resumes with the same key', async () => {
    lookups();
    const posts = bulk((post, call) =>
      call === 1
        ? errorBody(429, 'RATE_LIMITED', undefined, { 'Retry-After': '0' })
        : created(post),
    );
    const user = userEvent.setup();
    renderPage();
    await toPreview(user, csv(3));
    await user.click(startButton());
    expect(await screen.findByText(/Created certificates: 3/)).toBeInTheDocument();
    expect(posts).toHaveLength(2);
    expect(posts[1]?.key).toBe(posts[0]?.key);
  });

  it('retries network errors with the same key, at most three times', async () => {
    lookups();
    const posts = bulk((post, call) => (call <= 2 ? HttpResponse.error() : created(post)));
    const user = userEvent.setup();
    renderPage();
    await toPreview(user, csv(3));
    await user.click(startButton());
    expect(await screen.findByText(/Created certificates: 3/)).toBeInTheDocument();
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((p) => p.key)).size).toBe(1);
  });

  it('stops after three failed retries of a network error', async () => {
    lookups();
    const posts = bulk(() => HttpResponse.error());
    const user = userEvent.setup();
    renderPage();
    await toPreview(user, csv(3));
    await user.click(startButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    expect(posts).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Resume import' })).toBeInTheDocument();
  });

  it('keeps the rows of a chunk with an unknown outcome in place until it succeeds', async () => {
    lookups();
    const posts = bulk((post, call) => (call <= 4 ? HttpResponse.error() : created(post)));
    const user = userEvent.setup();
    renderPage();
    await toPreview(user, csv(3));
    await user.click(startButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('outcome of the failed part');
    await user.click(screen.getByRole('button', { name: 'Back to preview' }));
    expect(screen.getByRole('checkbox', { name: 'Import row 2' })).toBeDisabled();
    await user.click(startButton());
    expect(await screen.findByText(/Created certificates: 3/)).toBeInTheDocument();
    expect(posts).toHaveLength(5);
    expect(new Set(posts.map((p) => p.key)).size).toBe(1);
  });

  it('covers rows without a date in the list link range', async () => {
    lookups();
    bulk();
    const user = userEvent.setup();
    renderPage();
    await toPreview(user, 'Full name,Email\nAnna,a@example.com');
    await user.click(startButton());
    const link = await screen.findByRole('link', { name: 'View imported certificates' });
    const day = new Date().toISOString().slice(0, 10);
    expect(link.getAttribute('href')).toContain(`issuedFrom=${day}&issuedTo=${day}`);
  });

  it('asks before leaving while the import runs', async () => {
    lookups();
    bulk(() => delay('infinite').then(() => new Response(null, { status: 500 })));
    const user = userEvent.setup();
    const { router } = renderPage();
    await toPreview(user, csv(3));
    await user.click(startButton());
    await screen.findByText('Sending…');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    void router.navigate('/admin/other');
    const dialog = await screen.findByRole('dialog', { name: 'Leave while importing?' });
    await user.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(router.state.location.pathname).toBe('/admin/certificates/import');
    void router.navigate('/admin/other');
    await user.click(await screen.findByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/other'));
  });

  it('navigates the preview table with the keyboard and keeps it accessible', async () => {
    lookups();
    const user = userEvent.setup();
    const { container } = renderPage();
    await toPreview(user, csv(700));
    const region = screen.getByRole('region', { name: /Scrollable table/ });
    expect(region).toHaveAttribute('tabindex', '0');
    const first = screen.getByRole('checkbox', { name: 'Import row 2' });
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('checkbox', { name: 'Import row 3' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'Import row 3' })).not.toBeChecked();
    await user.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();

    // Scrolling renders the rows in view and drops the others.
    region.scrollTop = 64 * 400;
    fireEvent.scroll(region);
    expect(await screen.findByRole('checkbox', { name: 'Import row 402' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Import row 2' })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('offers the template downloads and rejects an unreadable file', async () => {
    lookups();
    const user = userEvent.setup();
    const { container } = renderPage();
    expect(await screen.findByRole('button', { name: 'Download template (.xlsx)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download template (.csv)' })).toBeEnabled();
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('button', { name: 'Continue to preview' }));
    expect(await screen.findByText('Choose an organization.')).toBeInTheDocument();
    expect(screen.getByText('Choose a file to import.')).toBeInTheDocument();
  });
});
