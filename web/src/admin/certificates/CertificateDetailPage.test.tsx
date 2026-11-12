import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import CertificateDetailPage from './CertificateDetailPage';

const toDataURL = vi.hoisted(() => vi.fn());
vi.mock('qrcode', () => ({ toDataURL, default: { toDataURL } }));

setupMswServer();

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const URL_ = `*/api/v1/admin/certificates/${ID}`;
const ts = '2026-11-04T10:15:30.000Z';
const CERT = {
  id: ID,
  ownerName: 'Aysel Məmmədova',
  email: 'aysel@example.org',
  subject: 'Attended DevFest',
  skills: ['React', 'TypeScript'],
  organizationId: 'o1',
  organizationName: 'Acme',
  eventId: 'e1',
  eventName: 'DevFest',
  type: 'attendance',
  templateId: 'acme-devfest-attendance-v2',
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
  emailStatus: 'sent',
  emailAttempts: 1,
  emailLastError: null,
  emailSentAt: ts,
  legacy: null,
};

function renderPage(id = ID) {
  return renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/admin/certificates/:id" element={<CertificateDetailPage />} />
      </Routes>
    </ToastProvider>,
    { route: `/admin/certificates/${id}` },
  );
}

beforeEach(() => {
  toDataURL.mockReset();
  toDataURL.mockResolvedValue('data:image/png;base64,AAAA');
});

describe('CertificateDetailPage', () => {
  it('shows an active certificate with its sections, actions and QR of the public URL', async () => {
    server.use(http.get(URL_, () => HttpResponse.json(CERT)));
    const { container } = renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Aysel Məmmədova' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    for (const name of ['Recipient', 'Issuance', 'Status', 'PDF', 'Email', 'Public link']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByTestId('masked-email')).toHaveTextContent('a***@e***.org');
    expect(screen.queryByText('aysel@example.org')).not.toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'acme-devfest-attendance-v2' })).toHaveAttribute(
      'href',
      '/admin/templates/acme-devfest-attendance-v2',
    );
    expect(screen.getByRole('link', { name: /Open PDF/ })).toHaveAttribute(
      'href',
      'https://storage.example.org/cert.pdf',
    );
    const open = screen.getByRole('link', { name: /Open public page/ });
    expect(open).toHaveAttribute('href', `/c/${ID}`);
    expect(open).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend email' })).toBeInTheDocument();

    const expectedUrl = `${window.location.origin}/c/${ID}`;
    expect(screen.getByLabelText('Public link address')).toHaveTextContent(expectedUrl);
    const img = await screen.findByRole('img', {
      name: `QR code of the public link: ${expectedUrl}`,
    });
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(toDataURL).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
    expect(screen.getByRole('link', { name: 'Download QR code as PNG' })).toHaveAttribute(
      'download',
      `certificate-${ID}.png`,
    );
    await expectNoA11yViolations(container);
  });

  it('copies the public link', async () => {
    server.use(http.get(URL_, () => HttpResponse.json(CERT)));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage();
    const button = await screen.findByRole('button', { name: 'Copy link' }, { timeout: 5000 });
    button.click();
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/c/${ID}`);
  });

  it('hides Revoke and Resend and shows reason and date for a revoked certificate', async () => {
    server.use(
      http.get(URL_, () =>
        HttpResponse.json({
          ...CERT,
          status: 'revoked',
          revokedAt: ts,
          revokeReason: 'Issued by mistake',
        }),
      ),
    );
    const { container } = renderPage();
    expect(
      await screen.findByText('Issued by mistake', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText('Revoked on').nextElementSibling).toHaveTextContent('Nov 4, 2026');
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend email' })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('handles a certificate without an email address', async () => {
    server.use(
      http.get(URL_, () =>
        HttpResponse.json({
          ...CERT,
          email: null,
          emailStatus: 'skipped',
          emailAttempts: 0,
          emailSentAt: null,
          pdfGeneratedAt: null,
          pdfUrl: null,
          skills: [],
        }),
      ),
    );
    const { container } = renderPage();
    expect(
      await screen.findByText('No address given', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.getByText('None listed')).toBeInTheDocument();
    // A first send is possible once an address is entered, so the action stays available.
    expect(screen.getByRole('button', { name: 'Resend email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open PDF/ })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('shows a failed email with attempts and last error', async () => {
    server.use(
      http.get(URL_, () =>
        HttpResponse.json({
          ...CERT,
          emailStatus: 'failed',
          emailAttempts: 3,
          emailLastError: 'BOUNCED: Mailbox unavailable',
          emailSentAt: null,
        }),
      ),
    );
    const { container } = renderPage();
    expect(
      await screen.findByText('The email bounced: Mailbox unavailable', undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend email' })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('shows a localized 404 for an unknown ID', async () => {
    server.use(
      http.get(URL_, () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'x', requestId: 'r1' } },
          { status: 404 },
        ),
      ),
    );
    const { container } = renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Certificate not found' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to certificates' })).toHaveAttribute(
      'href',
      '/admin/certificates',
    );
    await expectNoA11yViolations(container);
  });

  it('shows the 404 for a malformed ID without calling the API', async () => {
    const calls = vi.fn();
    server.use(
      http.get('*/api/v1/admin/certificates/:id', () => {
        calls();
        return HttpResponse.json(CERT);
      }),
    );
    renderPage('not-an-id');
    expect(
      await screen.findByRole('heading', { name: 'Certificate not found' }),
    ).toBeInTheDocument();
    expect(calls).not.toHaveBeenCalled();
  });

  it('shows an error state with retry on a server error', async () => {
    server.use(
      http.get(URL_, () =>
        HttpResponse.json(
          { error: { code: 'internal', message: 'x', requestId: 'r2' } },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    expect(
      await screen.findByRole('button', { name: /Retry|Try again/ }, { timeout: 10000 }),
    ).toBeInTheDocument();
  }, 15000);

  it('reveals and hides the email address with the toggle', async () => {
    server.use(http.get(URL_, () => HttpResponse.json(CERT)));
    renderPage();
    const show = await screen.findByRole(
      'button',
      { name: 'Show email address' },
      { timeout: 5000 },
    );
    await userEvent.click(show);
    expect(screen.getByTestId('masked-email')).toHaveTextContent('aysel@example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Hide email address' }));
    expect(screen.getByTestId('masked-email')).toHaveTextContent('a***@e***.org');
  });

  it.each([
    ['pending', 'Pending', null, null],
    ['sent', 'Sent', null, ts],
    ['skipped', 'Skipped', null, null],
    ['failed', 'Failed', 'ENQUEUE_FAILED', null],
  ] as const)('shows the %s email status with an icon', async (status, label, error, sentAt) => {
    server.use(
      http.get(URL_, () =>
        HttpResponse.json({
          ...CERT,
          emailStatus: status,
          emailLastError: error,
          emailSentAt: sentAt,
        }),
      ),
    );
    const { container } = renderPage();
    const badge = await screen.findByText(label, undefined, { timeout: 5000 });
    expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    await expectNoA11yViolations(container);
  });

  it.each([
    ['ENQUEUE_FAILED', 'The email could not be queued. Resend it.'],
    ['REJECTED: invalid recipient', 'The mail provider rejected the email: invalid recipient'],
    ['RETRIES_EXHAUSTED', 'Delivery failed after several attempts.'],
    ['DAILY_CAP_EXHAUSTED', 'The daily sending limit was reached. Resend tomorrow.'],
    ['BOUNCED: mailbox full', 'The email bounced: mailbox full'],
    ['SOMETHING_NEW', 'The email could not be delivered.'],
  ])('maps the last error %s to a message', async (code, message) => {
    server.use(
      http.get(URL_, () =>
        HttpResponse.json({
          ...CERT,
          emailStatus: 'failed',
          emailAttempts: 2,
          emailLastError: code,
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText(message, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(code)).not.toBeInTheDocument();
  });

  it('shows the last sent date', async () => {
    server.use(http.get(URL_, () => HttpResponse.json(CERT)));
    renderPage();
    const term = await screen.findByText('Sent on', undefined, { timeout: 5000 });
    expect(term.nextElementSibling).toHaveTextContent('Nov 4, 2026');
  });
});
