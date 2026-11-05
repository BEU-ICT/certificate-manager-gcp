import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, queryClient } from '@/api';
import i18n from '@/i18n';
import { expectNoA11yViolations } from '@/test/axe';
import { fakeAuth, SIGNED_IN } from '@/test/fakeAuth';
import { server, setupMswServer } from '@/test/server';
import AdminApp from './AdminApp';
import LoginPage from './LoginPage';
import { RequireAdmin } from './RequireAdmin';
import { useAdminSession } from './session-context';

vi.mock('@/auth', async (importOriginal) => {
  const { authMockModule } = await import('@/test/fakeAuth');
  return authMockModule(await importOriginal());
});

setupMswServer();

const ME = {
  uid: 'u1',
  email: 'admin@example.org',
  role: 'admin',
  features: { bulkIssuance: true, publicPdfGeneration: false },
};
const errorBody = (code: string) => ({ error: { code, message: 'x', requestId: 'r1' } });

const protectedRender = vi.fn();
function Protected() {
  const session = useAdminSession();
  protectedRender();
  return <p>Admin content for {session.email}</p>;
}

function renderGuard(initial = '/admin/certificates?page=2') {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      {
        path: '/admin/*',
        element: (
          <RequireAdmin>
            <Protected />
          </RequireAdmin>
        ),
      },
    ],
    { initialEntries: [initial] },
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, ...view };
}

/** Responses currently held by the query cache (empty placeholders do not count). */
const cachedData = () =>
  queryClient
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.data !== undefined);

beforeAll(async () => {
  await i18n.loadNamespaces('admin');
});

beforeEach(() => {
  queryClient.clear();
  protectedRender.mockClear();
  fakeAuth.reset();
  server.use(http.get('*/api/v1/admin/me', () => HttpResponse.json(ME)));
});

describe('RequireAdmin', () => {
  it('shows a skeleton and requests nothing while the session is restored', async () => {
    let requests = 0;
    server.use(
      http.get('*/api/v1/admin/me', () => {
        requests++;
        return HttpResponse.json(ME);
      }),
    );
    fakeAuth.reset({ status: 'loading', user: null });
    const { container, router } = renderGuard();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    await expectNoA11yViolations(container);
    expect(protectedRender).not.toHaveBeenCalled();
    expect(requests).toBe(0);
    expect(router.state.location.pathname).toBe('/admin/certificates');
  });

  it('redirects a signed-out visitor to /login and back after signing in', async () => {
    const { router } = renderGuard();
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ from: '/admin/certificates?page=2' });
    expect(protectedRender).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Email/), 'admin@example.org');
    await user.type(screen.getByLabelText(/^Password/), 's3cret-pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Admin content for admin@example.org')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/certificates');
    expect(router.state.location.search).toBe('?page=2');
  });

  it('renders nothing of the admin area until /admin/me succeeded', async () => {
    server.use(
      http.get('*/api/v1/admin/me', async () => {
        await delay(100);
        return HttpResponse.json(ME);
      }),
    );
    fakeAuth.reset(SIGNED_IN);
    renderGuard();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(protectedRender).not.toHaveBeenCalled();
    expect(await screen.findByText('Admin content for admin@example.org')).toBeInTheDocument();
  });

  it('sends the bearer token with the /admin/me request', async () => {
    let authorization: string | null = null;
    server.use(
      http.get('*/api/v1/admin/me', ({ request }) => {
        authorization = request.headers.get('Authorization');
        return HttpResponse.json(ME);
      }),
    );
    fakeAuth.reset(SIGNED_IN);
    renderGuard();
    await screen.findByText(/Admin content/);
    expect(authorization).toBe('Bearer tok');
  });

  it('signs out a non-administrator and explains it on /login', async () => {
    server.use(
      http.get('*/api/v1/admin/me', () =>
        HttpResponse.json(errorBody('FORBIDDEN'), { status: 403 }),
      ),
    );
    fakeAuth.reset(SIGNED_IN);
    const { router } = renderGuard();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account has no administrator access',
    );
    expect(fakeAuth.signOut).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ reason: 'noAccess' });
    expect(protectedRender).not.toHaveBeenCalled();
  });

  it('ends an expired session after the forced refresh failed, clears the cache and says so', async () => {
    fakeAuth.reset(SIGNED_IN);
    const { router } = renderGuard();
    await screen.findByText(/Admin content/);
    expect(cachedData()).toHaveLength(1);

    server.use(
      http.get('*/api/v1/admin/certificates', () =>
        HttpResponse.json(errorBody('UNAUTHENTICATED'), { status: 401 }),
      ),
    );
    await expect(api().get('/admin/certificates')).rejects.toBeInstanceOf(ApiError);
    expect(fakeAuth.getIdToken).toHaveBeenCalledWith(true);

    expect(await screen.findByRole('status')).toHaveTextContent('Your session expired');
    expect(fakeAuth.signOut).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toMatchObject({ reason: 'expired' });
    expect(cachedData()).toHaveLength(0);
  });

  it('follows a sign-out from another tab and drops the cached data', async () => {
    fakeAuth.reset(SIGNED_IN);
    const { router } = renderGuard('/admin/events');
    await screen.findByText(/Admin content/);
    expect(cachedData()).toHaveLength(1);

    fakeAuth.set({ status: 'signedOut', user: null }); // what the SDK reports for another tab
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.state).toEqual({ from: '/admin/events' });
    expect(cachedData()).toHaveLength(0);
  });

  it('offers a retry when /admin/me cannot be reached and still renders nothing', async () => {
    let fail = true;
    server.use(
      http.get('*/api/v1/admin/me', () =>
        fail ? HttpResponse.json(errorBody('INTERNAL'), { status: 500 }) : HttpResponse.json(ME),
      ),
    );
    fakeAuth.reset(SIGNED_IN);
    const { container } = renderGuard();
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 8000 });
    expect(protectedRender).not.toHaveBeenCalled();
    await expectNoA11yViolations(container);
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText(/Admin content/)).toBeInTheDocument();
  }, 20_000);
});

describe('AdminApp', () => {
  function renderAdminApp(initial = '/admin') {
    const router = createMemoryRouter(
      [
        { path: '/login', element: <LoginPage /> },
        { path: '/admin/*', element: <AdminApp /> },
      ],
      { initialEntries: [initial] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return router;
  }

  it('shows the administrator email and signs out through the layout', async () => {
    fakeAuth.reset(SIGNED_IN);
    const router = renderAdminApp('/admin/templates');
    expect(await screen.findByText('Signed in as admin@example.org')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('This section is coming soon.');
    expect(cachedData()).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(fakeAuth.signOut).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toBeNull(); // a deliberate sign-out is not "expired"
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(cachedData()).toHaveLength(0);
    expect(screen.queryByText('Signed in as admin@example.org')).not.toBeInTheDocument();
  });

  it('loads the admin screens only after the administrator is confirmed', async () => {
    fakeAuth.reset(SIGNED_IN);
    server.use(
      http.get('*/api/v1/admin/me', () =>
        HttpResponse.json(errorBody('FORBIDDEN'), { status: 403 }),
      ),
    );
    renderAdminApp();
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Dashboard')).not.toBeInTheDocument());
  });
});
