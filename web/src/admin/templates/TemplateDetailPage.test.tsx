import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import TemplateDetailPage from './TemplateDetailPage';

setupMswServer();

const REF = 'acme-devfest-attendance-v2';
const DETAIL_URL = `*/api/v1/admin/templates/${REF}`;
const COPY_URL = `${DETAIL_URL}/copy`;
const ts = '2026-11-04T10:15:30.000Z';
const DETAIL = {
  reference: REF,
  organizationId: 'o1',
  organizationSlug: 'acme',
  eventId: 'e1',
  eventSlug: 'devfest',
  type: 'attendance',
  version: 2,
  createdAt: ts,
  isLatest: true,
  config: { width: 800, fields: [{ id: 'name' }] },
  files: [
    { path: 'config.json', size: 120 },
    { path: 'background.png', size: 2048 },
  ],
  certificateCount: 1234,
};
const ORG = (id: string, name: string) => ({ id, name, slug: name, createdAt: ts, updatedAt: ts });
const lookups = () => [
  http.get('*/api/v1/admin/organizations', () =>
    HttpResponse.json({ items: [ORG('o1', 'Acme'), ORG('o2', 'Beta')], nextCursor: null }),
  ),
  http.get('*/api/v1/admin/events', () =>
    HttpResponse.json({
      items: [
        {
          id: 'e9',
          organizationId: 'o2',
          organizationName: 'Beta',
          name: 'Hack',
          slug: 'hack',
          emailLanguage: 'az',
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      nextCursor: null,
    }),
  ),
];

function Location() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname}</div>;
}

function renderPage(reference = REF) {
  return renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/admin/templates/:reference" element={<TemplateDetailPage />} />
      </Routes>
      <Location />
    </ToastProvider>,
    { route: `/admin/templates/${reference}` },
  );
}

async function openCopyDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Copy to another event' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(await within(dialog).findByLabelText(/Organization/), 'o2');
  await userEvent.selectOptions(
    within(dialog).getByLabelText(/Event/),
    await within(dialog).findByRole('option', { name: 'Hack' }),
  );
  return dialog;
}

describe('TemplateDetailPage', () => {
  it('reports clipboard success and failure in toasts', async () => {
    server.use(
      ...lookups(),
      http.get(DETAIL_URL, () => HttpResponse.json(DETAIL)),
    );
    renderPage();
    const button = await screen.findByRole('button', { name: `Copy reference ${REF}` });
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('no'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(button);
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(REF);
    await userEvent.click(button);
    expect(await screen.findByText('Could not copy to clipboard')).toBeInTheDocument();
  });

  it('shows summary, files, count, immutability note and the new-version link; passes axe', async () => {
    server.use(
      ...lookups(),
      http.get(DETAIL_URL, () => HttpResponse.json(DETAIL)),
    );
    const { container } = renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: new RegExp(REF) })).toBeVisible();
    expect(screen.getByText(/Templates cannot be edited/)).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('background.png')).toBeInTheDocument();
    expect(screen.getByText(/2 kB/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New version' })).toHaveAttribute(
      'href',
      `/admin/templates/new?from=${REF}`,
    );
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    await expectNoA11yViolations(container);
  });

  it('lazy-loads the config viewer when expanded', async () => {
    server.use(
      ...lookups(),
      http.get(DETAIL_URL, () => HttpResponse.json(DETAIL)),
    );
    const { container } = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Show configuration' }));
    const pre = await screen.findByLabelText('Template configuration (JSON)');
    expect(pre).toHaveTextContent('"width": 800');
    await expectNoA11yViolations(container);
  });

  it('shows the 404 page for an unknown reference', async () => {
    server.use(
      http.get('*/api/v1/admin/templates/nope', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } },
          { status: 404 },
        ),
      ),
    );
    const { container } = renderPage('nope');
    expect(await screen.findByRole('heading', { name: 'Template not found' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to templates' })).toHaveAttribute(
      'href',
      '/admin/templates',
    );
    await expectNoA11yViolations(container);
  });

  it('copies to another event and navigates to the new template', async () => {
    let body: unknown;
    server.use(
      ...lookups(),
      http.get(DETAIL_URL, () => HttpResponse.json(DETAIL)),
      http.post(COPY_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            reference: 'beta-hack-attendance-v1',
            organizationId: 'o2',
            organizationSlug: 'beta',
            eventId: 'e9',
            eventSlug: 'hack',
            type: 'attendance',
            version: 1,
            createdAt: ts,
            isLatest: true,
            copiedFrom: REF,
          },
          { status: 201 },
        );
      }),
    );
    renderPage();
    const dialog = await openCopyDialog();
    await expectNoA11yViolations(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy template' }));
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent(
        '/admin/templates/beta-hack-attendance-v1',
      ),
    );
    expect(body).toEqual({ organizationId: 'o2', eventId: 'e9' });
  });

  it('sends the chosen type and requires organization and event', async () => {
    let body: unknown;
    server.use(
      ...lookups(),
      http.get(DETAIL_URL, () => HttpResponse.json(DETAIL)),
      http.post(COPY_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ reference: 'beta-hack-thanks-v1' }, { status: 201 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Copy to another event' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy template' }));
    // The placeholder option has the same text as the error, so two matches mean the error shows.
    await waitFor(() =>
      expect(within(dialog).getAllByText('Select an organization')).toHaveLength(2),
    );
    expect(within(dialog).getAllByText('Select an event')).toHaveLength(2);
    expect(body).toBeUndefined();
    await userEvent.selectOptions(within(dialog).getByLabelText(/Organization/), 'o2');
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/Event/),
      await within(dialog).findByRole('option', { name: 'Hack' }),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'thanks');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy template' }));
    await waitFor(() =>
      expect(body).toEqual({ organizationId: 'o2', eventId: 'e9', type: 'thanks' }),
    );
  });

  it('maps a 422 to the field and keeps the dialog open', async () => {
    server.use(
      ...lookups(),
      http.get(DETAIL_URL, () => HttpResponse.json(DETAIL)),
      http.post(COPY_URL, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'x',
              requestId: 'r',
              details: [{ path: 'eventId', message: 'EVENT_ORG_MISMATCH' }],
            },
          },
          { status: 422 },
        ),
      ),
    );
    renderPage();
    const dialog = await openCopyDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy template' }));
    expect(
      await within(dialog).findByText('This event does not belong to the selected organization'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('could not be copied');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent(`/admin/templates/${REF}`);
  });
});
