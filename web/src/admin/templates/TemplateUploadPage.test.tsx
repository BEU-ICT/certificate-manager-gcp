import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@/components';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server, setupMswServer } from '@/test/server';
import TemplateUploadPage from './TemplateUploadPage';

setupMswServer();

const UPLOAD = '*/api/v1/admin/templates';
const ts = '2026-11-04T10:15:30.000Z';
const CONFIG = JSON.stringify({
  background: 'background.svg',
  fonts: { main: 'fonts/Inter.ttf' },
});

function pick(name: string, content: string | number, relative: string): File {
  const file = new File([typeof content === 'number' ? new Uint8Array(content) : content], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: relative });
  return file;
}
const goodFolder = () => [
  pick('config.json', CONFIG, 'my-template/config.json'),
  pick('background.svg', '<svg/>', 'my-template/background.svg'),
  pick('Inter.ttf', 2048, 'my-template/fonts/Inter.ttf'),
];

const lookups = () => [
  http.get('*/api/v1/admin/organizations', () =>
    HttpResponse.json({
      items: [{ id: 'o1', name: 'Acme', slug: 'acme', createdAt: ts, updatedAt: ts }],
      nextCursor: null,
    }),
  ),
  http.get('*/api/v1/admin/events', () =>
    HttpResponse.json({
      items: [
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
      ],
      nextCursor: null,
    }),
  ),
];

const RESULT = {
  reference: 'acme-devfest-attendance-v3',
  version: 3,
  organizationId: 'o1',
  eventId: 'e1',
  type: 'attendance',
  config: {},
  files: [{ path: 'config.json', size: 10 }],
  warnings: [
    {
      code: 'UNREFERENCED_FILE',
      path: 'assets/old.png',
      file: 'assets/old.png',
      message: 'Not referenced by config.json',
    },
  ],
  createdAt: ts,
};

function Location() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderPage(route = '/admin/templates/new') {
  return renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/admin/templates/new" element={<TemplateUploadPage />} />
        <Route path="/admin/templates/:reference" element={<Location />} />
      </Routes>
    </ToastProvider>,
    { route },
  );
}

async function fillTarget(user: ReturnType<typeof userEvent.setup>) {
  const organization = await screen.findByLabelText(/Organization/);
  await screen.findByRole('option', { name: 'Acme' });
  await user.selectOptions(organization, 'o1');
  const event = await screen.findByRole('combobox', { name: /Event/ });
  await screen.findByRole('option', { name: 'DevFest' });
  await user.selectOptions(event, 'e1');
  await user.selectOptions(screen.getByLabelText(/Type/), 'attendance');
}
async function pickFolder(user: ReturnType<typeof userEvent.setup>, files: File[]) {
  await user.upload(await screen.findByLabelText('Choose folder'), files);
}

describe('TemplateUploadPage', () => {
  it('maps a picked folder to package paths with sizes and passes axe', async () => {
    server.use(...lookups());
    const user = userEvent.setup();
    const { container } = renderPage();
    await pickFolder(user, goodFolder());

    const tree = await screen.findByRole('list', { name: 'Files in the package' });
    const rows = within(tree)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(rows).toEqual([
      expect.stringContaining('background.svg'),
      expect.stringContaining('config.json'),
      expect.stringMatching(/^fonts\/Inter\.ttf2 kB$/),
    ]);
    expect(screen.getByText(/3 files selected/)).toBeInTheDocument();
    expect(screen.queryByText('Fix these problems before uploading')).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('offers keyboard-reachable file inputs as the fallback', async () => {
    server.use(...lookups());
    renderPage();
    for (const name of ['Choose folder', 'Choose files']) {
      const input = await screen.findByLabelText(name);
      expect(input).toHaveAttribute('type', 'file');
      expect(input).not.toHaveAttribute('tabindex', '-1');
    }
  });

  it('shows client-side pre-check errors and does not call the API', async () => {
    let called = false;
    server.use(
      ...lookups(),
      http.post(UPLOAD, () => {
        called = true;
        return HttpResponse.json(RESULT, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillTarget(user);
    await pickFolder(user, [
      pick('config.json', '{ nope', 'p/config.json'),
      pick('notes.txt', 'x', 'p/notes.txt'),
    ]);
    expect(await screen.findByText('config.json is not valid JSON.')).toBeInTheDocument();
    expect(screen.getByText(/notes\.txt: this file is not allowed here/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(called).toBe(false);
  });

  it('reports a config that refers to files missing from the package', async () => {
    server.use(...lookups());
    const user = userEvent.setup();
    renderPage();
    await pickFolder(user, [pick('config.json', CONFIG, 'p/config.json')]);
    expect(
      await screen.findByText(/config\.json refers to background\.svg \(background\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/refers to fonts\/Inter\.ttf \(fonts\.main\)/)).toBeInTheDocument();
  });

  it('flags the package limits: file count and total size', async () => {
    server.use(...lookups());
    const user = userEvent.setup();
    renderPage();
    const many = Array.from({ length: 31 }, (_, i) =>
      pick(`${String(i)}.png`, 1, `p/assets/${String(i)}.png`),
    );
    await pickFolder(user, [pick('config.json', '{}', 'p/config.json'), ...many]);
    expect(await screen.findByText(/has 31 files; at most 30/)).toBeInTheDocument();
    await pickFolder(user, [
      pick('config.json', '{}', 'p/config.json'),
      pick('a.png', 4_000_000, 'p/a.png'),
      pick('b.png', 4_000_000, 'p/b.png'),
      pick('c.png', 4_000_000, 'p/c.png'),
    ]);
    expect(await screen.findByText('The package is larger than 10 MB.')).toBeInTheDocument();
  });

  it('requires organization, event, type and files', async () => {
    server.use(...lookups());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    expect(await screen.findAllByText('Select an organization')).not.toHaveLength(0);
    expect(screen.getAllByText('Select an event')).not.toHaveLength(0);
    expect(screen.getByText('Select a type')).toBeInTheDocument();
    expect(screen.getByText('Choose the template folder or files first.')).toBeInTheDocument();
  });

  it('uploads the multipart package and shows the success screen', async () => {
    let form: FormData | undefined;
    server.use(
      ...lookups(),
      http.post(UPLOAD, async ({ request }) => {
        form = await request.formData();
        return HttpResponse.json(RESULT, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillTarget(user);
    await pickFolder(user, goodFolder());
    await user.click(await screen.findByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('heading', { name: 'Template uploaded' })).toBeInTheDocument();
    expect(screen.getByText('acme-devfest-attendance-v3', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('assets/old.png')).toBeInTheDocument();
    expect(screen.getByText('Not referenced by config.json')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();

    expect(form?.get('organizationId')).toBe('o1');
    expect(form?.get('eventId')).toBe('e1');
    expect(form?.get('type')).toBe('attendance');
    expect((form?.get('config') as File).name).toBe('config.json');
    expect((form?.get('fonts/Inter.ttf') as File).name).toBe('fonts/Inter.ttf');
    expect((form?.get('background.svg') as File).name).toBe('background.svg');

    await user.click(screen.getByRole('button', { name: 'Open template' }));
    expect(await screen.findByTestId('loc')).toHaveTextContent(
      '/admin/templates/acme-devfest-attendance-v3',
    );
  });

  it('renders 422 findings grouped by file, keeps the files and allows a retry', async () => {
    let attempts = 0;
    server.use(
      ...lookups(),
      http.post(UPLOAD, () => {
        attempts += 1;
        if (attempts > 1) return HttpResponse.json(RESULT, { status: 201 });
        return HttpResponse.json(
          {
            error: {
              code: 'TEMPLATE_INVALID',
              message: 'The template package is invalid',
              details: [
                {
                  code: 'SVG_SCRIPT',
                  path: 'background.svg',
                  file: 'background.svg',
                  message: 'Script elements are not allowed',
                },
                {
                  code: 'SVG_ONLOAD',
                  path: 'background.svg',
                  file: 'background.svg',
                  message: 'Event handlers are not allowed',
                },
                {
                  code: 'FILE_NOT_FOUND',
                  path: 'fonts.main',
                  file: 'fonts/Inter.ttf',
                  message: 'File is missing',
                },
                {
                  code: 'UNREFERENCED_FILE',
                  path: 'assets/x.png',
                  file: 'assets/x.png',
                  message: 'Not used',
                },
              ],
              requestId: 'req-1',
            },
          },
          { status: 422 },
        );
      }),
    );
    const user = userEvent.setup();
    const { container } = renderPage();
    await fillTarget(user);
    await pickFolder(user, goodFolder());
    await user.click(await screen.findByRole('button', { name: 'Upload' }));

    const alert = await screen.findByText(/The server rejected the package/);
    const box = alert.closest('[role="alert"]') as HTMLElement;
    expect(within(box).getByText('4 findings')).toBeInTheDocument();
    const groups = within(box)
      .getAllByRole('listitem', { name: '' })
      .filter((li) => li.querySelector('ul'));
    expect(groups.map((g) => g.querySelector('code')?.textContent)).toEqual([
      'assets/x.png',
      'background.svg',
      'fonts/Inter.ttf',
    ]);
    expect(within(groups[1] as HTMLElement).getAllByText('Error')).toHaveLength(2);
    expect(within(groups[0] as HTMLElement).getByText('Warning')).toBeInTheDocument();
    // The selection survives so the author can fix and retry.
    expect(screen.getByRole('list', { name: 'Files in the package' })).toBeInTheDocument();
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByRole('heading', { name: 'Template uploaded' })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('marks the event when it belongs to another organization', async () => {
    server.use(
      ...lookups(),
      http.post(UPLOAD, () =>
        HttpResponse.json(
          {
            error: {
              code: 'EVENT_ORG_MISMATCH',
              message: 'The event does not belong to the organization',
              details: [
                { path: 'eventId', message: 'This event belongs to a different organization' },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await fillTarget(user);
    await pickFolder(user, goodFolder());
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    expect(
      await screen.findAllByText('This event does not belong to the selected organization'),
    ).not.toHaveLength(0);
  });

  it('shows the error message of other failures (413)', async () => {
    server.use(
      ...lookups(),
      http.post(UPLOAD, () =>
        HttpResponse.json(
          { error: { code: 'PAYLOAD_TOO_LARGE', message: 'too big' } },
          { status: 413 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await fillTarget(user);
    await pickFolder(user, goodFolder());
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    expect(await screen.findByRole('alert', { name: '' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('alert').some((a) => /too large|large/i.test(a.textContent ?? '')),
    ).toBe(true);
  });

  it('prevents a double submit, warns before leaving and cancels the upload', async () => {
    let posts = 0;
    server.use(
      ...lookups(),
      http.post(UPLOAD, async () => {
        posts += 1;
        await delay('infinite');
        return HttpResponse.json(RESULT, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillTarget(user);
    await pickFolder(user, goodFolder());
    await user.click(await screen.findByRole('button', { name: 'Upload' }));

    const busy = await screen.findByRole('button', { name: /Uploading/ });
    expect(busy).toBeDisabled();
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Cancel upload' }));
    expect(await screen.findByText(/Upload cancelled/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
    expect(posts).toBe(1);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('prefills and locks organization, event and type for a new version', async () => {
    let form: FormData | undefined;
    server.use(
      ...lookups(),
      http.get('*/api/v1/admin/templates/acme-devfest-attendance-v2', () =>
        HttpResponse.json({
          reference: 'acme-devfest-attendance-v2',
          organizationId: 'o1',
          organizationSlug: 'acme',
          eventId: 'e1',
          eventSlug: 'devfest',
          type: 'attendance',
          version: 2,
          createdAt: ts,
          isLatest: true,
          config: {},
          files: [],
          certificateCount: 0,
        }),
      ),
      http.post(UPLOAD, async ({ request }) => {
        form = await request.formData();
        return HttpResponse.json(RESULT, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage('/admin/templates/new?from=acme-devfest-attendance-v2');
    expect(
      await screen.findByRole('heading', { name: 'Upload a new version' }),
    ).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('devfest')).toBeInTheDocument();
    expect(screen.getByText('Attendance')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Organization/)).not.toBeInTheDocument();

    await pickFolder(user, goodFolder());
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(form).toBeDefined());
    expect(form?.get('organizationId')).toBe('o1');
    expect(form?.get('eventId')).toBe('e1');
    expect(form?.get('type')).toBe('attendance');
  });
});
