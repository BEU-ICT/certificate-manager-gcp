import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, type AuthState } from '@/auth';
import i18n from '@/i18n';
import { expectNoA11yViolations } from '@/test/axe';
import { server, setupMswServer } from '@/test/server';
import ForgotPasswordPage from './ForgotPasswordPage';
import LoginPage from './LoginPage';

const auth = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = {
    state: { status: 'signedOut', user: null } as AuthState,
    set: (next: AuthState) => {
      store.state = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    store,
    signIn: vi.fn<(email: string, password: string) => Promise<unknown>>(),
    signOut: vi.fn<() => Promise<void>>(),
    sendPasswordReset: vi.fn<(email: string) => Promise<void>>(),
    getIdToken: vi.fn<(force?: boolean) => Promise<string | null>>(),
  };
});

vi.mock('@/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/auth')>();
  const { useSyncExternalStore } = await import('react');
  return {
    ...actual,
    useAuth: () => useSyncExternalStore(auth.store.subscribe, () => auth.store.state),
    preloadAuth: vi.fn(),
    signIn: auth.signIn,
    signOut: auth.signOut,
    sendPasswordReset: auth.sendPasswordReset,
    getIdToken: auth.getIdToken,
  };
});

setupMswServer();

const ME = { uid: 'u1', email: 'admin@example.org', role: 'admin', features: {} };
const errorBody = (code: string) => ({ error: { code, message: 'x', requestId: 'r1' } });

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderLogin(entry: { search?: string; state?: unknown } = {}) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/login/forgot-password', element: <ForgotPasswordPage /> },
      { path: '*', element: <Where /> },
    ],
    { initialEntries: [{ pathname: '/login', search: entry.search ?? '', state: entry.state }] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

async function fillAndSubmit(email = 'admin@example.org', password = 's3cret-pass') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Email/), email);
  await user.type(screen.getByLabelText(/^Password/), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeAll(async () => {
  await i18n.loadNamespaces('admin'); // lazily loaded by the route in the app
});

beforeEach(() => {
  auth.store.state = { status: 'signedOut', user: null };
  auth.signIn.mockReset().mockImplementation(() => {
    auth.store.set({ status: 'signedIn', user: { uid: 'u1', email: 'admin@example.org' } });
    return Promise.resolve({ uid: 'u1', email: 'admin@example.org' });
  });
  auth.signOut.mockReset().mockImplementation(() => {
    auth.store.set({ status: 'signedOut', user: null });
    return Promise.resolve();
  });
  auth.sendPasswordReset.mockReset().mockResolvedValue(undefined);
  auth.getIdToken.mockReset().mockResolvedValue('tok');
  server.use(http.get('*/api/v1/admin/me', () => HttpResponse.json(ME)));
});

describe('LoginPage form', () => {
  it('renders an accessible form without a registration entry point', async () => {
    const { container } = renderLogin();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('autocomplete', 'current-password');
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/login/forgot-password']);
    expect(screen.queryByText(/register|sign up|create account/i)).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('shows inline validation errors and focuses the first invalid field', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toHaveFocus();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
    expect(auth.signIn).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/^Email/), 'not-an-email');
    await userEvent.type(screen.getByLabelText(/^Password/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('validation errors pass axe', async () => {
    const { container } = renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Enter your email');
    await expectNoA11yViolations(container);
  });

  it('toggles password visibility', async () => {
    renderLogin();
    const input = screen.getByLabelText(/^Password/);
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('works with the keyboard only and Enter submits', async () => {
    const { router } = renderLogin();
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByLabelText(/^Email/)).toHaveFocus();
    await user.keyboard('admin@example.org');
    await user.tab();
    await user.keyboard('s3cret-pass{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(auth.signIn).toHaveBeenCalledWith('admin@example.org', 's3cret-pass');
  });

  it('keeps the password out of the URL', async () => {
    const { router } = renderLogin();
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toBeNull();
  });
});

describe('LoginPage errors', () => {
  it.each([
    ['invalidCredentials', 'Email or password is incorrect'],
    ['tooManyRequests', 'Too many attempts, try again later'],
    ['network', 'Network error. Check your connection.'],
    ['disabled', 'This account has been disabled.'],
    ['unknown', 'Something went wrong. Try again.'],
  ] as const)('shows the message for %s and re-enables the form', async (kind, message) => {
    auth.signIn.mockRejectedValue(new AuthError(kind));
    renderLogin();
    await fillAndSubmit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('wrong password and unknown user show the very same text', async () => {
    auth.signIn.mockRejectedValue(new AuthError('invalidCredentials'));
    const first = renderLogin();
    await fillAndSubmit('known@example.org', 'wrong');
    const text = (await screen.findByRole('alert')).textContent;
    first.unmount();
    renderLogin();
    await fillAndSubmit('nobody@example.org', 'wrong');
    expect((await screen.findByRole('alert')).textContent).toBe(text);
    expect(auth.signIn).toHaveBeenCalledTimes(2);
  });

  it('403 from /admin/me signs out and explains the missing access', async () => {
    server.use(
      http.get('*/api/v1/admin/me', () =>
        HttpResponse.json(errorBody('FORBIDDEN'), { status: 403 }),
      ),
    );
    const { router } = renderLogin();
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account has no administrator access',
    );
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/login');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('401 from /admin/me signs out with a generic error', async () => {
    server.use(
      http.get('*/api/v1/admin/me', () =>
        HttpResponse.json(errorBody('UNAUTHENTICATED'), { status: 401 }),
      ),
    );
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(auth.getIdToken).toHaveBeenCalledWith(true); // one forced refresh before giving up
  });

  it('a server error signs out and shows the localized error', async () => {
    server.use(
      http.get('*/api/v1/admin/me', () =>
        HttpResponse.json(errorBody('INTERNAL'), { status: 500 }),
      ),
    );
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('An unexpected error occurred');
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});

describe('LoginPage redirects', () => {
  it('sends the bearer token to /admin/me and lands on /admin by default', async () => {
    let authorization: string | null = null;
    server.use(
      http.get('*/api/v1/admin/me', ({ request }) => {
        authorization = request.headers.get('Authorization');
        return HttpResponse.json(ME);
      }),
    );
    const { router } = renderLogin();
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(authorization).toBe('Bearer tok');
  });

  it('returns to the originally requested admin route', async () => {
    const { router } = renderLogin({ state: { from: '/admin/certificates?page=2' } });
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/certificates'));
    expect(router.state.location.search).toBe('?page=2');
  });

  it('honours ?next= for an internal admin path', async () => {
    const { router } = renderLogin({ search: '?next=/admin/templates' });
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/templates'));
  });

  it.each(['?next=https://evil.test', '?next=//evil.test/admin', '?next=/login'])(
    'ignores the open-redirect attempt %s',
    async (search) => {
      const { router } = renderLogin({ search });
      await fillAndSubmit();
      await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
      expect(window.location.hostname).not.toBe('evil.test');
    },
  );

  it('ignores a foreign target in the router state', async () => {
    const { router } = renderLogin({ state: { from: 'https://evil.test/admin' } });
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });

  it('redirects an already signed-in user away from /login', async () => {
    auth.store.state = { status: 'signedIn', user: { uid: 'u1', email: 'admin@example.org' } };
    const { router } = renderLogin({ state: { from: '/admin/events' } });
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/events'));
  });

  it('explains an expired session', () => {
    renderLogin({ state: { reason: 'expired', from: '/admin' } });
    expect(screen.getByRole('status')).toHaveTextContent('Your session expired');
  });

  it('shows the no-access notice handed over by the route guard', () => {
    renderLogin({ state: { reason: 'noAccess' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Your account has no administrator access');
  });
});

describe('ForgotPasswordPage', () => {
  async function openForgot() {
    const view = renderLogin();
    await userEvent.click(screen.getByRole('link', { name: 'Forgot password?' }));
    await screen.findByRole('heading', { name: 'Reset password' });
    return view;
  }

  it('validates the email', async () => {
    await openForgot();
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(auth.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('shows the same confirmation for any address and passes axe', async () => {
    const { container } = await openForgot();
    await userEvent.type(screen.getByLabelText(/^Email/), 'someone@example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(
      'If this address belongs to an administrator, an email was sent',
    );
    expect(auth.sendPasswordReset).toHaveBeenCalledWith('someone@example.org');
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
    await expectNoA11yViolations(container);
  });

  it('reports network and rate-limit failures without a confirmation', async () => {
    await openForgot();
    await userEvent.type(screen.getByLabelText(/^Email/), 'someone@example.org');
    auth.sendPasswordReset.mockRejectedValueOnce(new AuthError('network'));
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
    auth.sendPasswordReset.mockRejectedValueOnce(new AuthError('tooManyRequests'));
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts, try again later'),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
