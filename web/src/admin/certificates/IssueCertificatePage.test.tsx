import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import IssueCertificatePage from './IssueCertificatePage';

setupMswServer();

const ts = '2026-11-04T10:15:30.000Z';
type User = ReturnType<typeof userEvent.setup>;

const template = (version: number, isLatest: boolean) => ({
  reference: `acme-devfest-attendance-v${String(version)}`,
  version,
  isLatest,
  organizationId: 'o1',
  organizationSlug: 'acme',
  eventId: 'e1',
  eventSlug: 'devfest',
  type: 'attendance',
  createdAt: ts,
});

interface Seen {
  templateQueries: URLSearchParams[];
  posts: { body: Record<string, unknown>; key: string | null }[];
}

function lookups(templates = [template(2, true), template(1, false)]): Seen {
  const seen: Seen = { templateQueries: [], posts: [] };
  server.use(
    http.get('*/api/v1/admin/organizations', () =>
      HttpResponse.json({
        items: [{ id: 'o1', name: 'Acme', slug: 'acme', createdAt: ts, updatedAt: ts }],
        nextCursor: null,
      }),
    ),
    http.get('*/api/v1/admin/events', ({ request }) => {
      const org = new URL(request.url).searchParams.get('organizationId');
      return HttpResponse.json({
        items:
          org === 'o1'
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
      });
    }),
    http.get('*/api/v1/admin/templates', ({ request }) => {
      seen.templateQueries.push(new URL(request.url).searchParams);
      return HttpResponse.json({ items: templates, nextCursor: null });
    }),
  );
  return seen;
}

const CERTIFICATE = {
  id: 'abc123abc123abc123abc1',
  ownerName: 'Aysel Məmmədova',
  publicUrl: 'https://certs.example/c/abc123abc123abc123abc1',
};

function created(seen: Seen) {
  server.use(
    http.post('*/api/v1/admin/certificates', async ({ request }) => {
      seen.posts.push({
        body: (await request.json()) as Record<string, unknown>,
        key: request.headers.get('Idempotency-Key'),
      });
      return HttpResponse.json(CERTIFICATE, { status: 201 });
    }),
  );
}

function failing(
  seen: Seen,
  status: number,
  code: string,
  details?: unknown,
  headers?: HeadersInit,
) {
  server.use(
    http.post('*/api/v1/admin/certificates', async ({ request }) => {
      seen.posts.push({
        body: (await request.json()) as Record<string, unknown>,
        key: request.headers.get('Idempotency-Key'),
      });
      return HttpResponse.json(
        { error: { code, message: 'Failed', ...(details ? { details } : {}) } },
        { status, ...(headers ? { headers } : {}) },
      );
    }),
  );
}

function Location() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderPage() {
  return renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/admin/certificates/new" element={<IssueCertificatePage />} />
        <Route path="/admin/certificates/:id" element={<Location />} />
        <Route path="/admin/templates/new" element={<Location />} />
      </Routes>
    </ToastProvider>,
    { route: '/admin/certificates/new' },
  );
}

async function chooseTarget(user: User) {
  await screen.findByRole('option', { name: 'Acme' });
  await user.selectOptions(screen.getByLabelText(/Organization/), 'o1');
  await screen.findByRole('option', { name: 'DevFest' });
  await user.selectOptions(screen.getByLabelText(/^Event/), 'e1');
  await user.selectOptions(screen.getByLabelText(/^Type/), 'attendance');
}

async function fillPerson(user: User) {
  await user.type(screen.getByLabelText(/Owner name/), 'Aysel Məmmədova');
  await user.type(screen.getByLabelText(/^Subject/), 'Attended DevFest');
}

const submit = () => screen.getByRole('button', { name: 'Issue certificate' });

describe('IssueCertificatePage', () => {
  it('filters events by organization and templates by organization, event and type', async () => {
    const seen = lookups();
    const user = userEvent.setup();
    const { container } = renderPage();
    expect(await screen.findByLabelText(/^Event/)).toBeDisabled();
    expect(screen.getByLabelText(/^Template/)).toBeDisabled();
    await chooseTarget(user);

    const select = screen.getByLabelText(/^Template/);
    await waitFor(() => expect(select).toBeEnabled());
    expect(seen.templateQueries.at(-1)?.get('organizationId')).toBe('o1');
    expect(seen.templateQueries.at(-1)?.get('eventId')).toBe('e1');
    expect(seen.templateQueries.at(-1)?.get('type')).toBe('attendance');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options[0]).toBe('Latest (acme-devfest-attendance-v2)');
    expect(options[1]).toMatch(/^acme-devfest-attendance-v1 \(version 1, /);
    expect(select).toHaveValue('');

    // Changing the organization clears event and template.
    await user.selectOptions(screen.getByLabelText(/Organization/), '');
    expect(screen.getByLabelText(/^Event/)).toHaveValue('');
    expect(screen.getByLabelText(/^Template/)).toBeDisabled();
    await expectNoA11yViolations(container);
  });

  it('disables the template select with an explanation and an upload link when none exists', async () => {
    lookups([]);
    const user = userEvent.setup();
    renderPage();
    await chooseTarget(user);
    expect(await screen.findByText(/No template exists for this organization/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Template/)).toBeDisabled();
    await user.click(screen.getByRole('link', { name: 'Upload a template' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/templates/new');
  });

  it('validates required fields, limits, email and the issue date with counters', async () => {
    lookups();
    const seen: Seen = { templateQueries: [], posts: [] };
    created(seen);
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText(/^Event/);
    await user.click(submit());
    expect(await screen.findByText('Choose an organization.')).toBeInTheDocument();
    expect(screen.getByText('Choose an event.')).toBeInTheDocument();
    expect(screen.getByText('Choose a type.')).toBeInTheDocument();
    expect(screen.getByText('Enter the owner name.')).toBeInTheDocument();
    expect(screen.getByText('Enter the subject.')).toBeInTheDocument();

    const owner = screen.getByLabelText(/Owner name/);
    await user.type(owner, 'x'.repeat(121));
    expect(screen.getByText('121 / 120 characters')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Email address/), 'not-an-email');
    fireEvent.change(screen.getByLabelText(/Issue date/), { target: { value: '2999-01-01' } });
    await user.click(submit());
    expect(
      await screen.findByText('The name must have at most 120 characters.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('The issue date must not be in the future.')).toBeInTheDocument();
    expect(screen.getByText('A link to the certificate will be emailed')).toBeInTheDocument();
    expect(seen.posts).toHaveLength(0);
  });

  it('adds skill chips, ignores duplicates, limits length and count', async () => {
    lookups();
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/^Skills/);
    await user.type(input, 'React{Enter}react{Enter}Node,');
    const list = screen.getByRole('list', { name: 'Added skills' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['React×', 'Node×']);

    await user.type(input, 'y'.repeat(41) + '{Enter}');
    expect(await screen.findByText('A skill must have at most 40 characters.')).toBeInTheDocument();
    await user.clear(input);
    for (let i = 0; i < 9; i++) await user.type(input, `s${String(i)}{Enter}`);
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    await user.type(input, 'extra{Enter}');
    expect(await screen.findByText('At most 10 skills are allowed.')).toBeInTheDocument();
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Remove skill Node' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);
  });

  it('issues, shows the success panel and keeps the settings for another one', async () => {
    const seen = lookups();
    created(seen);
    const user = userEvent.setup();
    renderPage();
    await chooseTarget(user);
    await waitFor(() => expect(screen.getByLabelText(/^Template/)).toBeEnabled());
    await user.selectOptions(screen.getByLabelText(/^Template/), 'acme-devfest-attendance-v1');
    await fillPerson(user);
    await user.type(screen.getByLabelText(/Email address/), 'Aysel@Example.com');
    await user.type(screen.getByLabelText(/^Skills/), 'React{Enter}');
    await user.click(submit());

    expect(await screen.findByRole('heading', { name: 'Certificate issued' })).toHaveFocus();
    expect(seen.posts).toHaveLength(1);
    const { body, key } = seen.posts[0] ?? { body: {}, key: null };
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({
      organizationId: 'o1',
      eventId: 'e1',
      type: 'attendance',
      templateId: 'acme-devfest-attendance-v1',
      ownerName: 'Aysel Məmmədova',
      email: 'aysel@example.com',
      subject: 'Attended DevFest',
      skills: ['React'],
    });
    expect(body['issuedAt']).toEqual(expect.any(String));
    expect(screen.getByLabelText('Public link address')).toHaveTextContent(CERTIFICATE.publicUrl);
    const open = screen.getByRole('link', { name: /Open public page/ });
    expect(open).toHaveAttribute('href', CERTIFICATE.publicUrl);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'));

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Issue another with same settings' }));
    expect(await screen.findByLabelText(/Owner name/)).toHaveValue('');
    expect(screen.getByLabelText(/Owner name/)).toHaveFocus();
    expect(screen.getByLabelText(/^Subject/)).toHaveValue('');
    expect(screen.getByLabelText(/Email address/)).toHaveValue('');
    expect(screen.getByLabelText(/Organization/)).toHaveValue('o1');
    expect(screen.getByLabelText(/^Event/)).toHaveValue('e1');
    expect(screen.getByLabelText(/^Type/)).toHaveValue('attendance');
    expect(screen.getByLabelText(/^Template/)).toHaveValue('acme-devfest-attendance-v1');

    await fillPerson(user);
    await user.click(submit());
    await screen.findByRole('heading', { name: 'Certificate issued' });
    expect(seen.posts[1]?.key).not.toBe(key);
    await user.click(screen.getByRole('button', { name: 'View certificate' }));
    expect(screen.getByTestId('loc')).toHaveTextContent(`/admin/certificates/${CERTIFICATE.id}`);
  });

  it('highlights the failing fields on 422 TEXT_DOES_NOT_FIT', async () => {
    const seen = lookups();
    failing(seen, 422, 'TEXT_DOES_NOT_FIT', [
      {
        path: 'ownerName',
        message: 'Text needs 3 lines at the minimum size 14 pt but the field allows 2',
      },
      {
        path: 'subject',
        message: 'Text needs 5 lines at the minimum size 12 pt but the field allows 3',
      },
    ]);
    const user = userEvent.setup();
    renderPage();
    await chooseTarget(user);
    await fillPerson(user);
    await user.click(submit());

    const owner = await screen.findByLabelText(/Owner name/);
    await waitFor(() => expect(owner).toHaveAttribute('aria-invalid', 'true'));
    expect(owner).toHaveAccessibleDescription(/Text needs 3 lines/);
    expect(screen.getByLabelText(/^Subject/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Some texts do not fit the template');
    expect(screen.getByLabelText(/^Email address/)).not.toHaveAttribute('aria-invalid');
  });

  it.each(['TEMPLATE_MISMATCH', 'TEMPLATE_NOT_FOUND'])(
    'shows an inline alert on 422 %s',
    async (code) => {
      const seen = lookups();
      failing(seen, 422, code, [{ path: 'templateId', message: 'x' }]);
      const user = userEvent.setup();
      renderPage();
      await chooseTarget(user);
      await fillPerson(user);
      await user.click(submit());
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        code === 'TEMPLATE_MISMATCH' ? 'does not match' : 'Template not found',
      );
      expect(alert).toHaveTextContent('Choose another template');
    },
  );

  it('gives retry guidance on 429 and 5xx and reuses the key until the form changes', async () => {
    const seen = lookups();
    failing(seen, 429, 'RATE_LIMITED', undefined, { 'Retry-After': '7' });
    const user = userEvent.setup();
    renderPage();
    await chooseTarget(user);
    await fillPerson(user);
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 7 seconds');

    failing(seen, 500, 'INTERNAL');
    await user.click(submit());
    await waitFor(() => expect(seen.posts).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Press “Issue certificate” again'),
    );
    expect(seen.posts[1]?.key).toBe(seen.posts[0]?.key);
    expect(seen.posts[1]?.body).toEqual(seen.posts[0]?.body);

    await user.type(screen.getByLabelText(/^Subject/), '!');
    await user.click(submit());
    await waitFor(() => expect(seen.posts).toHaveLength(3));
    expect(seen.posts[2]?.key).not.toBe(seen.posts[0]?.key);
  });

  it('sends exactly one request on a double click', async () => {
    const seen = lookups();
    let count = 0;
    server.use(
      http.post('*/api/v1/admin/certificates', async ({ request }) => {
        count++;
        seen.posts.push({ body: {}, key: request.headers.get('Idempotency-Key') });
        await delay(150);
        return HttpResponse.json(CERTIFICATE, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await chooseTarget(user);
    await fillPerson(user);
    await user.dblClick(submit());
    await screen.findByRole('heading', { name: 'Certificate issued' });
    expect(count).toBe(1);
  });

  it('can be completed with the keyboard alone', async () => {
    const seen = lookups();
    created(seen);
    const user = userEvent.setup();
    renderPage();
    await chooseTarget(user);
    await user.click(screen.getByLabelText(/Owner name/));
    await user.keyboard('Aysel{Tab}{Tab}Subject text{Tab}tag{Enter}');
    expect(screen.getByRole('list', { name: 'Added skills' })).toBeInTheDocument();
    expect(seen.posts).toHaveLength(0);
    screen.getByLabelText(/^Subject/).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { name: 'Certificate issued' });
    expect(seen.posts[0]?.body).toMatchObject({
      ownerName: 'Aysel',
      subject: 'Subject text',
      skills: ['tag'],
    });
  });
});
