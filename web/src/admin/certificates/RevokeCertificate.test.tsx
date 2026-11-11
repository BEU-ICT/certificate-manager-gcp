import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import CertificateDetailPage from './CertificateDetailPage';

vi.mock('qrcode', () => ({
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') },
}));

setupMswServer();

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const GET_URL = `*/api/v1/admin/certificates/${ID}`;
const REVOKE_URL = `*/api/v1/admin/certificates/${ID}/revoke`;
const ts = '2026-11-04T10:15:30.000Z';
const ACTIVE = {
  id: ID,
  ownerName: 'Aysel Məmmədova',
  email: null,
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
  emailStatus: 'skipped',
  emailAttempts: 0,
  emailLastError: null,
  emailSentAt: null,
  legacy: null,
};
const REVOKED = { ...ACTIVE, status: 'revoked', revokedAt: ts, revokeReason: 'Issued by mistake' };

/** GET returns the active certificate until a revoke succeeded, then the revoked one. */
function mockServer(revokeResponse: () => Response | Promise<Response>) {
  let revoked = false;
  const bodies: unknown[] = [];
  server.use(
    http.get(GET_URL, () => HttpResponse.json(revoked ? REVOKED : ACTIVE)),
    http.post(REVOKE_URL, async ({ request }) => {
      bodies.push(await request.json());
      const response = await revokeResponse();
      if (response.ok) revoked = true;
      return response;
    }),
  );
  return bodies;
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

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole('button', { name: 'Revoke' }, { timeout: 5000 });
  await user.click(trigger);
  return { trigger, dialog: await screen.findByRole('dialog', { name: 'Revoke certificate' }) };
}

async function fill(user: ReturnType<typeof userEvent.setup>, reason = 'Issued by mistake') {
  await user.type(screen.getByLabelText(/Reason for revocation/), reason);
  await user.click(screen.getByRole('checkbox', { name: 'I understand' }));
}

const submitButton = () => screen.getByRole('button', { name: 'Revoke certificate' });

describe('revoke dialog', () => {
  it('explains the consequences, validates and passes axe', async () => {
    mockServer(() => HttpResponse.json(REVOKED));
    const user = userEvent.setup();
    renderPage();
    const { dialog } = await openDialog(user);
    expect(dialog).toHaveTextContent(
      'The public page will show the certificate as revoked, the PDF will be deleted. This cannot be undone.',
    );
    expect(submitButton()).toBeDisabled();
    expect(screen.getByLabelText(/Reason for revocation/)).toHaveAccessibleDescription(/0 \/ 500/);

    await user.type(screen.getByLabelText(/Reason for revocation/), 'abc');
    expect(screen.getByLabelText(/Reason for revocation/)).toHaveAccessibleDescription(/3 \/ 500/);
    expect(submitButton()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'I understand' }));
    expect(submitButton()).toBeEnabled();

    await user.clear(screen.getByLabelText(/Reason for revocation/));
    expect(await screen.findByText('Enter a reason.')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await user.click(screen.getByLabelText(/Reason for revocation/));
    await user.paste('x'.repeat(501));
    expect(
      await screen.findByText('The reason must be at most 500 characters.'),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    await expectNoA11yViolations(dialog);
  });

  it('revokes, refreshes the detail, shows a toast and the revoked badge', async () => {
    const bodies = mockServer(() => HttpResponse.json({ ...REVOKED, warnings: [] }));
    const user = userEvent.setup();
    renderPage();
    await openDialog(user);
    await fill(user, '  <b>Issued</b> by mistake ');
    await user.click(submitButton());
    expect(await screen.findByText('Certificate revoked.')).toBeInTheDocument();
    expect(bodies).toEqual([{ reason: '<b>Issued</b> by mistake' }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    // Plain text: the markup is shown, not interpreted.
    expect(screen.getByText('Issued by mistake')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('shows the PDF cleanup warning and retries with the same reason', async () => {
    let calls = 0;
    const bodies = mockServer(() => {
      calls += 1;
      return HttpResponse.json(
        calls === 1 ? { ...REVOKED, warnings: ['PDF_DELETE_FAILED'] } : { ...REVOKED },
      );
    });
    const user = userEvent.setup();
    renderPage();
    await openDialog(user);
    await fill(user);
    await user.click(submitButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The certificate is revoked, but the PDF could not be deleted');
    await user.click(screen.getByRole('button', { name: 'Retry cleanup' }));
    expect(await screen.findByText('PDF deleted.')).toBeInTheDocument();
    expect(bodies).toEqual([{ reason: 'Issued by mistake' }, { reason: 'Issued by mistake' }]);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('keeps the warning and shows no success toast when the retry still fails', async () => {
    mockServer(() => HttpResponse.json({ ...REVOKED, warnings: ['PDF_DELETE_FAILED'] }));
    const user = userEvent.setup();
    renderPage();
    await openDialog(user);
    await fill(user);
    await user.click(submitButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Retry cleanup' }));
    expect(await screen.findByText(/Cleanup failed again/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('PDF deleted.')).not.toBeInTheDocument();
  });

  it('shows a localized message on 404 and keeps the dialog open', async () => {
    mockServer(() =>
      HttpResponse.json({ code: 'NOT_FOUND', message: 'nope', requestId: 'r1' }, { status: 404 }),
    );
    const user = userEvent.setup();
    renderPage();
    await openDialog(user);
    await fill(user);
    await user.click(submitButton());
    expect(await screen.findByText('This certificate no longer exists.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('sends only one request on a double submit', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies = mockServer(async () => {
      await gate;
      return HttpResponse.json(REVOKED);
    });
    const user = userEvent.setup();
    renderPage();
    await openDialog(user);
    await fill(user);
    const button = submitButton();
    await user.dblClick(button);
    await waitFor(() => expect(button).toBeDisabled());
    await user.click(button);
    release();
    expect(await screen.findByText('Certificate revoked.')).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    mockServer(() => HttpResponse.json(REVOKED));
    const user = userEvent.setup();
    renderPage();
    const { trigger } = await openDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
