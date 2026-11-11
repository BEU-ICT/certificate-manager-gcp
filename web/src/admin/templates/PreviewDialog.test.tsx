import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import { PreviewDialog } from './PreviewDialog';

setupMswServer();

const REF = 'acme-devfest-attendance-v2';
const URL_PATTERN = `*/api/v1/admin/templates/${REF}/preview`;
const pdf = () =>
  new HttpResponse('%PDF-1.4\n%%EOF', { headers: { 'Content-Type': 'application/pdf' } });

let create: ReturnType<typeof vi.fn>;
let revoke: ReturnType<typeof vi.fn>;
beforeEach(() => {
  let n = 0;
  create = vi.fn(() => `blob:preview-${String(++n)}`);
  revoke = vi.fn();
  URL.createObjectURL = create as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL;
});
afterEach(() => {
  vi.useRealTimers();
});

async function open(onClose = vi.fn()) {
  const view = renderWithProviders(<PreviewDialog reference={REF} onClose={onClose} />);
  await screen.findByRole('dialog');
  return { onClose, ...view };
}

describe('PreviewDialog', () => {
  it('has an accessible name, requests nothing before the click and passes axe', async () => {
    const calls = vi.fn();
    server.use(
      http.post(URL_PATTERN, () => {
        calls();
        return pdf();
      }),
    );
    await open();
    expect(screen.getByRole('dialog', { name: `Preview ${REF}` })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Typical' })).toBeChecked();
    await expectNoA11yViolations(document.body);
    expect(calls).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('renders the PDF into a titled iframe, offers download and revokes the URL on close', async () => {
    server.use(http.post(URL_PATTERN, pdf));
    const user = userEvent.setup();
    const { unmount } = await open();
    await user.click(screen.getByRole('button', { name: 'Render' }));
    const frame = await screen.findByTitle(`PDF preview of ${REF}`);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'blob:preview-1');
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'download',
      `preview-${REF}.pdf`,
    );
    expect(revoke).not.toHaveBeenCalled();
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:preview-1');
  });

  it('revokes the previous URL when rendering again and toggles the enlarged mode', async () => {
    server.use(http.post(URL_PATTERN, pdf));
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Render' }));
    await screen.findByTitle(`PDF preview of ${REF}`);
    await user.click(screen.getByRole('button', { name: 'Render' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:preview-1'));
    expect(await screen.findByTitle(`PDF preview of ${REF}`)).toHaveAttribute(
      'src',
      'blob:preview-2',
    );
    const toggle = screen.getByRole('button', { name: 'Enlarge' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Shrink' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('dialog')).toHaveClass('max-w-none');
  });

  it('sends the preset and overrides in the body', async () => {
    let body: unknown;
    server.use(
      http.post(URL_PATTERN, async ({ request }) => {
        body = await request.json();
        return pdf();
      }),
    );
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('radio', { name: /Longest/ }));
    await user.type(screen.getByLabelText('Name'), ' Ada ');
    await user.type(screen.getByLabelText('Subject'), 'Maths');
    await user.type(screen.getByLabelText('Skills', { exact: false }), 'One{Enter}Two');
    await user.type(screen.getByLabelText('Issue date'), '2026-03-04');
    await user.click(screen.getByRole('button', { name: 'Render' }));
    await screen.findByTitle(`PDF preview of ${REF}`);
    expect(body).toEqual({
      preset: 'longest',
      ownerName: 'Ada',
      subject: 'Maths',
      skills: ['One', 'Two'],
      issuedAt: '2026-03-04T00:00:00.000Z',
    });
  });

  it('validates the field limits without sending a request', async () => {
    const calls = vi.fn();
    server.use(
      http.post(URL_PATTERN, () => {
        calls();
        return pdf();
      }),
    );
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByLabelText('Name'));
    await user.paste('a'.repeat(121));
    await user.click(screen.getByRole('button', { name: 'Render' }));
    expect(await screen.findByText('At most 120 characters.')).toBeInTheDocument();
    expect(calls).not.toHaveBeenCalled();
  });

  it('shows the overflowing field, line count and advice on 422 TEXT_DOES_NOT_FIT', async () => {
    server.use(
      http.post(URL_PATTERN, () =>
        HttpResponse.json(
          {
            error: {
              code: 'TEXT_DOES_NOT_FIT',
              message: 'The text does not fit the template',
              requestId: 'r',
              details: [
                {
                  path: 'ownerName',
                  message: 'Text needs 3 lines at the minimum size 12 pt but the field allows 2',
                },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('radio', { name: /Longest/ }));
    await user.click(screen.getByRole('button', { name: 'Render' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The text does not fit the template.');
    expect(alert).toHaveTextContent('Name overflows by 1 line.');
    expect(alert).toHaveTextContent('adjust maxLines/size in the config and upload a new version');
    expect(screen.queryByTitle(`PDF preview of ${REF}`)).not.toBeInTheDocument();
  });

  it('honours Retry-After on 429 before enabling Retry', async () => {
    let calls = 0;
    server.use(
      http.post(URL_PATTERN, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { error: { code: 'RATE_LIMITED', message: 'x', requestId: 'r' } },
            { status: 429, headers: { 'Retry-After': '2' } },
          );
        }
        return pdf();
      }),
    );
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Render' }));
    const retry = await screen.findByRole('button', { name: /Retry in \d s/ });
    expect(retry).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Too many preview requests');
    const enabled = await screen.findByRole('button', { name: 'Retry' }, { timeout: 4000 });
    expect(enabled).toBeEnabled();
    await user.click(enabled);
    expect(await screen.findByTitle(`PDF preview of ${REF}`)).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('offers Retry on 503 and recovers', async () => {
    let calls = 0;
    server.use(
      http.post(URL_PATTERN, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              { error: { code: 'UNAVAILABLE', message: 'x', requestId: 'req-9' } },
              { status: 503 },
            )
          : pdf();
      }),
    );
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Render' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('took too long');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTitle(`PDF preview of ${REF}`)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows elapsed seconds while rendering', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(
      http.post(URL_PATTERN, async () => {
        await new Promise((resolve) => setTimeout(resolve, 3500));
        return pdf();
      }),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await open();
    await user.click(screen.getByRole('button', { name: 'Render' }));
    expect(await screen.findByText('Rendering… 0 s')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(screen.getByText(/Rendering… [12] s/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(await screen.findByTitle(`PDF preview of ${REF}`)).toBeInTheDocument();
  });
});
