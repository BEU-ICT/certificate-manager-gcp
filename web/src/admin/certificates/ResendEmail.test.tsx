import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import CertificateDetailPage from './CertificateDetailPage';
import { POLL_ATTEMPTS, POLL_INTERVAL_MS } from './ResendEmail';

vi.mock('qrcode', () => ({
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') },
}));

setupMswServer();

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const GET_URL = `*/api/v1/admin/certificates/${ID}`;
const RESEND_URL = `*/api/v1/admin/certificates/${ID}/resend-email`;
const ts = '2026-11-04T10:15:30.000Z';
const CERT = {
  id: ID,
  ownerName: 'Aysel Məmmədova',
  email: 'aysel@domain.com',
  subject: 'Attended DevFest',
  skills: [],
  organizationId: 'o1',
  organizationName: 'Acme',
  eventId: 'e1',
  eventName: 'DevFest',
  type: 'attendance',
  templateId: 'tpl',
  issuedAt: ts,
  createdAt: ts,
  updatedAt: ts,
  createdBy: 'admin-1',
  status: 'active',
  revokedAt: null,
  revokeReason: null,
  pdfGeneratedAt: ts,
  pdfUrl: 'https://storage.example.org/cert.pdf',
  publicUrl: `https://certs.example.org/c/${ID}`,
  emailStatus: 'failed',
  emailAttempts: 1,
  emailLastError: 'RETRIES_EXHAUSTED',
  emailSentAt: null,
  legacy: null,
};

/**
 * `statuses` are the e-mail statuses the GETs return, in order, after a successful resend (the
 * first one is the refetch right after the POST); the last one repeats.
 */
function mockServer(opts: { post?: () => Response; statuses?: string[]; cert?: object } = {}) {
  const bodies: unknown[] = [];
  let resent = false;
  let postGets = 0;
  const statuses = opts.statuses ?? ['pending'];
  server.use(
    http.get(GET_URL, () => {
      if (!resent) return HttpResponse.json({ ...CERT, ...opts.cert });
      const emailStatus = statuses[Math.min(postGets, statuses.length - 1)];
      postGets += 1;
      return HttpResponse.json({ ...CERT, ...opts.cert, emailStatus, emailLastError: null });
    }),
    http.post(RESEND_URL, async ({ request }) => {
      bodies.push(await request.json());
      const response =
        opts.post?.() ??
        HttpResponse.json({ emailStatus: 'pending', emailAttempts: 2 }, { status: 202 });
      if (response.ok) resent = true;
      return response;
    }),
  );
  return { bodies, gets: () => postGets };
}

function renderPage() {
  return renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/admin/certificates/:id" element={<CertificateDetailPage />} />
      </Routes>
    </ToastProvider>,
    { route: `/admin/certificates/${ID}` },
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function openDialog(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Resend email' }, { timeout: 5000 }));
  return screen.findByRole('dialog', { name: 'Resend email' });
}

const confirm = (user: User, dialog: HTMLElement) =>
  user.click(within(dialog).getByRole('button', { name: 'Resend email' }));

const error = (
  status: number,
  code: string,
  details?: { path: string; message: string }[],
  headers?: HeadersInit,
) =>
  HttpResponse.json(
    { error: { code, message: 'x', requestId: 'r1', details } },
    { status, headers: headers ?? {} },
  );

/** Lets `ms` of fake time pass and the resulting requests settle. */
async function tick(ms = POLL_INTERVAL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(): User {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

describe('resend email dialog', () => {
  it('shows the masked address with a reveal toggle and passes axe', async () => {
    mockServer();
    const user = setup();
    renderPage();
    const dialog = await openDialog(user);
    expect(within(dialog).getByTestId('masked-email')).toHaveTextContent('a***@d***.com');
    expect(within(dialog).queryByText('aysel@domain.com')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Show email address' }));
    expect(within(dialog).getByTestId('masked-email')).toHaveTextContent('aysel@domain.com');
    await user.click(within(dialog).getByRole('button', { name: 'Hide email address' }));
    expect(within(dialog).getByTestId('masked-email')).toHaveTextContent('a***@d***.com');
    expect(within(dialog).getByLabelText('Corrected address')).toBeInTheDocument();
    await expectNoA11yViolations(dialog);
  });

  it('resends to the stored address, refreshes the status and stops polling at sent', async () => {
    const { bodies, gets } = mockServer({ statuses: ['pending', 'pending', 'sent'] });
    const user = setup();
    renderPage();
    const dialog = await openDialog(user);
    await confirm(user, dialog);
    expect(await screen.findByText('Email queued.')).toBeInTheDocument();
    expect(bodies).toEqual([{}]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The refetch after the POST already shows `pending`.
    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(gets()).toBe(1);
    expect(screen.getByText('Checking the delivery status…')).toBeInTheDocument();

    await tick();
    expect(gets()).toBe(2);
    await tick();
    expect(gets()).toBe(3);
    expect(await screen.findByText('Email sent.')).toBeInTheDocument();
    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.queryByText('Checking the delivery status…')).not.toBeInTheDocument();
    await tick(POLL_INTERVAL_MS * 4);
    expect(gets()).toBe(3);
  });

  it('stops polling at failed', async () => {
    const { gets } = mockServer({ statuses: ['pending', 'failed'] });
    const user = setup();
    renderPage();
    await confirm(user, await openDialog(user));
    await screen.findByText('Email queued.');
    await tick();
    expect(await screen.findByText('Email delivery failed.')).toBeInTheDocument();
    await tick(POLL_INTERVAL_MS * 4);
    expect(gets()).toBe(2);
  });

  it(`polls at most ${POLL_ATTEMPTS} times while the email stays pending`, async () => {
    const { gets } = mockServer({ statuses: ['pending'] });
    const user = setup();
    renderPage();
    await confirm(user, await openDialog(user));
    await screen.findByText('Email queued.');
    for (let i = 0; i < POLL_ATTEMPTS; i += 1) await tick();
    expect(
      await screen.findByText('The email is still being sent. Check again later.'),
    ).toBeInTheDocument();
    expect(gets()).toBe(1 + POLL_ATTEMPTS);
    await tick(POLL_INTERVAL_MS * 4);
    expect(gets()).toBe(1 + POLL_ATTEMPTS);
    expect(screen.queryByText('Checking the delivery status…')).not.toBeInTheDocument();
  });

  it('does not poll before the interval has passed', async () => {
    const { gets } = mockServer({ statuses: ['pending', 'sent'] });
    const user = setup();
    renderPage();
    await confirm(user, await openDialog(user));
    await screen.findByText('Email queued.');
    await tick(POLL_INTERVAL_MS - 1000);
    expect(gets()).toBe(1);
  });

  it('sends a corrected address and validates it first', async () => {
    const { bodies } = mockServer({ statuses: ['sent'] });
    const user = setup();
    renderPage();
    const dialog = await openDialog(user);
    const field = within(dialog).getByLabelText('Corrected address');
    await user.type(field, 'not-an-email');
    await confirm(user, dialog);
    expect(await within(dialog).findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
    await user.clear(field);
    await user.type(field, '  new@example.org ');
    await confirm(user, dialog);
    await screen.findByText('Email queued.');
    expect(bodies).toEqual([{ email: 'new@example.org' }]);
  });

  it('requires an address when the certificate has none', async () => {
    const { bodies } = mockServer({
      cert: { email: null, emailStatus: 'skipped', emailLastError: null },
    });
    const user = setup();
    renderPage();
    const dialog = await openDialog(user);
    expect(within(dialog).getByText('No address on file')).toBeInTheDocument();
    await confirm(user, dialog);
    expect(await within(dialog).findByText('Enter an email address.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
    await expectNoA11yViolations(dialog);
  });

  it.each([
    [
      '409 CERTIFICATE_REVOKED',
      () => error(409, 'CONFLICT', [{ path: 'status', message: 'CERTIFICATE_REVOKED' }]),
      'The certificate is revoked; its email cannot be resent.',
    ],
    [
      '409 EMAIL_IN_PROGRESS',
      () => error(409, 'CONFLICT', [{ path: 'emailStatus', message: 'EMAIL_IN_PROGRESS' }]),
      'An email is already being sent. Wait for it to finish.',
    ],
    [
      '422 EMAIL_REQUIRED',
      () => error(422, 'EMAIL_REQUIRED'),
      'The certificate has no email address. Enter one.',
    ],
    [
      '429 with Retry-After',
      () => error(429, 'RATE_LIMITED', undefined, { 'Retry-After': '90' }),
      'Too many resends for this certificate. Try again in 90 seconds.',
    ],
    [
      '429 without Retry-After',
      () => error(429, 'RATE_LIMITED'),
      'Too many resends for this certificate. Try again later.',
    ],
    ['503 UNAVAILABLE', () => error(503, 'UNAVAILABLE'), null],
  ])('keeps the dialog open and explains %s', async (_name, post, message) => {
    mockServer({ post });
    const user = setup();
    renderPage();
    const dialog = await openDialog(user);
    await confirm(user, dialog);
    const alert = await within(dialog).findByRole('alert');
    if (message) expect(alert).toHaveTextContent(message);
    expect(screen.queryByText('Email queued.')).not.toBeInTheDocument();
    expect(screen.queryByText('Checking the delivery status…')).not.toBeInTheDocument();
    await expectNoA11yViolations(dialog);
    // Cancel closes and returns focus to the trigger.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Resend email' })).toHaveFocus();
  });

  it('refetches the certificate after a 503 (the certificate is now failed)', async () => {
    const { gets } = mockServer({ post: () => error(503, 'UNAVAILABLE') });
    const user = setup();
    renderPage();
    const dialog = await openDialog(user);
    let before = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && request.url.includes(ID)) before += 1;
    });
    await confirm(user, dialog);
    await within(dialog).findByRole('alert');
    await waitFor(() => expect(before).toBeGreaterThan(0));
    server.events.removeAllListeners();
    expect(gets()).toBe(0);
  });

  it('hides the action for a revoked certificate', async () => {
    mockServer({ cert: { status: 'revoked', revokedAt: ts, revokeReason: 'x' } });
    renderPage();
    await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Resend email' })).not.toBeInTheDocument();
  });
});
