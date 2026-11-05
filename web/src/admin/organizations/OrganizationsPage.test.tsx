import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import OrganizationsPage from './OrganizationsPage';

setupMswServer();

const LIST = '*/api/v1/admin/organizations';
const ITEM = (id: string, name: string, slug: string) => ({
  id,
  name,
  slug,
  createdAt: '2026-11-04T10:15:30.000Z',
  updatedAt: '2026-11-04T10:15:30.000Z',
});
const error = (status: number, code: string, details?: unknown[]) =>
  HttpResponse.json({ error: { code, message: 'x', requestId: 'req-42', details } }, { status });

function renderPage() {
  return renderWithProviders(
    <ToastProvider>
      <OrganizationsPage />
    </ToastProvider>,
  );
}

describe('OrganizationsPage list', () => {
  it('shows a skeleton, then the table, and passes axe', async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({ items: [ITEM('o1', 'Acme', 'acme')], nextCursor: null }),
      ),
    );
    const { container } = renderPage();
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('cell', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'acme' })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('shows the empty state with a create action', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })));
    renderPage();
    expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New organization' })).toBeInTheDocument();
  });

  it('shows the error state with the request id and retries', async () => {
    let calls = 0;
    server.use(
      http.get(LIST, () => {
        calls += 1;
        return calls === 1
          ? error(500, 'INTERNAL')
          : HttpResponse.json({ items: [ITEM('o1', 'Acme', 'acme')], nextCursor: null });
      }),
    );
    renderPage();
    expect(await screen.findByText(/req-42/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('cell', { name: 'Acme' })).toBeInTheDocument();
  });

  it('paginates with the cursor and switches the page size', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(LIST, ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.push(params);
        return params.get('cursor') === 'c2'
          ? HttpResponse.json({ items: [ITEM('o2', 'Beta', 'beta')], nextCursor: null })
          : HttpResponse.json({ items: [ITEM('o1', 'Acme', 'acme')], nextCursor: 'c2' });
      }),
    );
    renderPage();
    await screen.findByRole('cell', { name: 'Acme' });
    expect(seen[0]?.get('limit')).toBe('25');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByRole('cell', { name: 'Beta' })).toBeInTheDocument();
    expect(seen.at(-1)?.get('cursor')).toBe('c2');
    await userEvent.click(screen.getByRole('button', { name: /previous/i }));
    await screen.findByRole('cell', { name: 'Acme' });
    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '50');
    await waitFor(() => expect(seen.at(-1)?.get('limit')).toBe('50'));
    expect(seen.at(-1)?.get('cursor')).toBeNull();
  });
});

describe('create dialog', () => {
  async function openCreate() {
    await userEvent.click(await screen.findByRole('button', { name: 'New organization' }));
    return screen.getByRole('dialog');
  }

  it('suggests the slug live from the name and creates the organization', async () => {
    let body: unknown;
    let created = false;
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({
          items: created ? [ITEM('o1', 'Əhməd Təşkilat', 'ehmed-teskilat')] : [],
          nextCursor: null,
        }),
      ),
      http.post(LIST, async ({ request }) => {
        body = await request.json();
        created = true;
        return HttpResponse.json(ITEM('o1', 'Əhməd Təşkilat', 'ehmed-teskilat'), { status: 201 });
      }),
    );
    renderPage();
    const dialog = await openCreate();
    await expectNoA11yViolations(dialog);
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Əhməd Təşkilat');
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveValue('ehmed-teskilat');
    expect(within(dialog).getByText(/cannot be changed/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Organization "Əhməd Təşkilat" created')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Əhməd Təşkilat', slug: 'ehmed-teskilat' });
    expect(await screen.findByRole('cell', { name: 'ehmed-teskilat' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stops following the name once the slug is edited', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })));
    renderPage();
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Acme');
    await userEvent.clear(within(dialog).getByLabelText(/^Slug/));
    await userEvent.type(within(dialog).getByLabelText(/^Slug/), 'custom');
    await userEvent.type(within(dialog).getByLabelText(/^Name/), ' Inc');
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveValue('custom');
  });

  it('validates required name and slug format without calling the API', async () => {
    server.use(http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })));
    renderPage();
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('Enter a name')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Acme');
    await userEvent.clear(within(dialog).getByLabelText(/^Slug/));
    await userEvent.type(within(dialog).getByLabelText(/^Slug/), 'Bad Slug');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText(/lowercase letters/)).toBeInTheDocument();
  });

  it('shows SLUG_TAKEN on the slug field and applies the suggestion', async () => {
    const bodies: { slug: string }[] = [];
    server.use(
      http.get(LIST, () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post(LIST, async ({ request }) => {
        const body = (await request.json()) as { name: string; slug: string };
        bodies.push(body);
        return body.slug === 'acme'
          ? error(409, 'CONFLICT', [{ path: 'slug', message: 'SLUG_TAKEN', suggestion: 'acme-2' }])
          : HttpResponse.json(ITEM('o2', body.name, body.slug), { status: 201 });
      }),
    );
    renderPage();
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Acme');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('This slug is already taken')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Slug/)).toBeInvalid();
    await expectNoA11yViolations(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use "acme-2"?' }));
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveValue('acme-2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Organization "Acme" created')).toBeInTheDocument();
    expect(bodies.map((b) => b.slug)).toEqual(['acme', 'acme-2']);
  });
});

describe('rename and delete', () => {
  const listAcme = () =>
    http.get(LIST, () =>
      HttpResponse.json({ items: [ITEM('o1', 'Acme', 'acme')], nextCursor: null }),
    );

  it('renames the name only and shows the slug read-only', async () => {
    let body: unknown;
    server.use(
      listAcme(),
      http.patch(`${LIST}/o1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(ITEM('o1', 'Acme Corp', 'acme'));
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Acme' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/^Slug/)).toHaveAttribute('readonly');
    await expectNoA11yViolations(dialog);
    const name = within(dialog).getByLabelText(/^Name/);
    expect(name).toHaveValue('Acme');
    await userEvent.clear(name);
    await userEvent.type(name, 'Acme Corp');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Organization renamed to "Acme Corp"')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Acme Corp' });
  });

  it('deletes after confirmation and refreshes the list', async () => {
    let deleted = false;
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({
          items: deleted ? [] : [ITEM('o1', 'Acme', 'acme')],
          nextCursor: null,
        }),
      ),
      http.delete(`${LIST}/o1`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Acme' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Organization "Acme" deleted')).toBeInTheDocument();
    expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
  });

  it('explains a 409 IN_USE with the counts and keeps the organization', async () => {
    server.use(
      listAcme(),
      http.delete(`${LIST}/o1`, () =>
        error(409, 'CONFLICT', [
          {
            path: 'references',
            message: 'IN_USE',
            counts: { events: 2, templates: 1, certificates: 30 },
          },
        ]),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Acme' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByText('2 events')).toBeInTheDocument();
    expect(within(dialog).getByText('1 template')).toBeInTheDocument();
    expect(within(dialog).getByText('30 certificates')).toBeInTheDocument();
    expect(within(dialog).getByText(/Remove these items first/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await expectNoA11yViolations(dialog);
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(screen.getByRole('cell', { name: 'Acme' })).toBeInTheDocument();
  });
});
