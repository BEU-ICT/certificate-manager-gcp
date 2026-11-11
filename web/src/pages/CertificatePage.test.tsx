import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import CertificatePage from './CertificatePage';

setupMswServer();

const URL_PATTERN = '*/api/v1/public/certificates/:id';
const GENERATION = 'http://localhost/api/v1/public/certificates/cert-1/pdf';
const CERT = {
  id: 'cert-1',
  ownerName: 'Aysel <b>Məmmədova</b>',
  organizationName: 'Acme',
  eventName: 'DevFest 2026',
  type: 'attendance',
  subject: 'Cloud workshop',
  skills: ['Kubernetes', 'Terraform'],
  issuedAt: '2026-11-04T10:15:30.000Z',
  status: 'active',
  pdfUrl: GENERATION,
};
const REVOKED = { ...CERT, status: 'revoked', pdfUrl: null };

function Loc() {
  return <div data-testid="loc">{useLocation().search}</div>;
}
function renderPage(id = 'cert-1') {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/c/:id" element={<CertificatePage />} />
      </Routes>
      <Loc />
    </>,
    { route: `/c/${id}?lang=en` },
  );
}
const serve = (body: JsonBodyType, init?: ResponseInit) =>
  server.use(http.get(URL_PATTERN, () => HttpResponse.json(body, init)));
const apiError = (status: number, code: string) =>
  serve({ error: { code, message: 'x', requestId: 'req-7' } }, { status });

afterEach(async () => {
  await i18n.changeLanguage('en');
  document.title = '';
});

describe('CertificatePage', () => {
  it('shows a skeleton with a single h1 while loading', async () => {
    server.use(http.get(URL_PATTERN, () => new Promise(() => undefined)));
    const { container } = renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Checking the certificate…' }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('renders a valid certificate with escaped text, localized values and the title without the name', async () => {
    serve(CERT);
    const { container } = renderPage();
    expect(await screen.findByText('Certificate is valid')).toBeInTheDocument();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Aysel <b>Məmmədova</b>');
    expect(h1.querySelector('b')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Attendance')).toBeInTheDocument();
    expect(screen.getByText('November 4, 2026')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes')).toBeInTheDocument();
    expect(screen.getByText('cert-1')).toBeInTheDocument();
    expect(document.title).toBe('Certificate verification — Acme');
    expect(document.title).not.toContain('Aysel');
    const link = screen.getByRole('link', { name: /Download PDF/ });
    expect(link).toHaveAttribute('href', GENERATION);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expectNoA11yViolations(container);
  });

  it('shows the preparing status for 15 s after clicking the generation link', async () => {
    serve(CERT);
    renderPage();
    const link = await screen.findByRole('link', { name: /Download PDF/ });
    link.addEventListener('click', (event) => event.preventDefault());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(link);
      expect(screen.getByText(/Preparing your certificate/)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(15_100);
      });
      expect(screen.queryByText(/Preparing your certificate/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show the preparing status for a direct PDF URL', async () => {
    serve({ ...CERT, pdfUrl: 'https://pdf.example.org/pdfs/a.pdf' });
    renderPage();
    const link = await screen.findByRole('link', { name: /Download PDF/ });
    link.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(link);
    expect(screen.queryByText(/Preparing your certificate/)).not.toBeInTheDocument();
  });

  it('never renders a non-http download link', async () => {
    serve({ ...CERT, pdfUrl: 'javascript:alert(1)' });
    renderPage();
    await screen.findByText('Certificate is valid');
    expect(screen.queryByRole('link', { name: /Download PDF/ })).not.toBeInTheDocument();
  });

  it('renders a revoked certificate with details but no download', async () => {
    serve(REVOKED);
    const { container } = renderPage();
    expect(await screen.findByText('This certificate has been revoked')).toBeInTheDocument();
    expect(screen.getByText(/contact the issuer/)).toBeInTheDocument();
    expect(screen.getByText('DevFest 2026')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Download PDF/ })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('shows the not-found message for an unknown id', async () => {
    apiError(404, 'NOT_FOUND');
    const { container } = renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Certificate not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('We could not find this certificate. Check the link or QR code.'),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('shows the same not-found message for a malformed id and encodes it in the request', async () => {
    const seen: string[] = [];
    server.use(
      http.get(URL_PATTERN, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 });
      }),
    );
    renderPage('%3Cscript%3E..%2F..');
    expect(await screen.findByText(/We could not find this certificate/)).toBeInTheDocument();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^\/api\/v1\/public\/certificates\/[^/]+$/);
  });

  it('counts down on 429 and retries automatically', async () => {
    let calls = 0;
    server.use(
      http.get(URL_PATTERN, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              { error: { code: 'RATE_LIMITED', message: 'x' } },
              { status: 429, headers: { 'Retry-After': '1' } },
            )
          : HttpResponse.json(CERT);
      }),
    );
    const { container } = renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Too many requests' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Too many requests, please try again in 1 second').length,
    ).toBeGreaterThan(0);
    await expectNoA11yViolations(container);
    expect(
      await screen.findByText('Certificate is valid', undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('shows a friendly error with the request id and a working retry', async () => {
    apiError(500, 'INTERNAL');
    const { container } = renderPage();
    expect(
      await screen.findByText(/We could not load this certificate/, undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Request ID: req-7')).toBeInTheDocument();
    await expectNoA11yViolations(container);
    serve(CERT);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Certificate is valid')).toBeInTheDocument();
  }, 15000);

  it('shows the offline message on a network failure', async () => {
    server.use(http.get(URL_PATTERN, () => HttpResponse.error()));
    renderPage();
    expect(
      await screen.findByText(/could not reach the server/i, undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
  }, 15000);

  it('keeps ?lang= in step with the active language and localizes the content', async () => {
    serve(CERT);
    renderPage();
    await screen.findByText('Certificate is valid');
    expect(screen.getByTestId('loc')).toHaveTextContent('?lang=en');
    await act(() => i18n.changeLanguage('az'));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('?lang=az'));
    expect(await screen.findByText('Sertifikat etibarlıdır')).toBeInTheDocument();
    expect(document.title).toBe('Sertifikatın yoxlanılması — Acme');
  });
});
