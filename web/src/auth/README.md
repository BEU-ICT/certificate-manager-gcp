# auth

The only module allowed to import the Firebase SDK (ESLint `no-restricted-imports` for static
imports plus `no-restricted-syntax` for dynamic `import()`, with negative fixtures in
`scripts/eslint-firebase.test.mjs`). A different OIDC provider can replace it later (BEU-ICT/certificate-manager#427) without
touching the rest of the app.

## Public interface (`@/auth`)

| Export                      | Purpose                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `signIn(email, password)`   | Resolves with `{ uid, email }`, rejects with an `AuthError`                            |
| `signOut()`                 | Ends the session (propagates to other tabs through `onAuthStateChanged`)               |
| `sendPasswordReset(email)`  | Firebase reset email; unknown or malformed addresses resolve like known ones           |
| `onAuthStateChanged(cb)`    | Fires with the restored session, then on every change; returns an unsubscribe function |
| `getIdToken(forceRefresh?)` | Current ID token or `null`; waits for the restored session; `true` bypasses the cache  |
| `useAuth()`                 | `{ status: 'loading' \| 'signedOut' \| 'signedIn', user }`                             |
| `preloadAuth()`             | Starts loading the SDK without waiting                                                 |
| `AuthError`, `isAuthError`  | Error with `kind` in `AUTH_ERROR_KINDS`                                                |

Error kinds: `invalidCredentials` (wrong password, unknown user and malformed email alike, so the
UI shows one generic message), `tooManyRequests`, `network`, `disabled`, `unknown`.

## Loading and bundles

The SDK is loaded with dynamic `import()` the first time an operation or `useAuth()` needs it, so
it is a separate `firebase` chunk fetched only by `/login` and `/admin/*`. Only code under
`src/admin` and `src/auth` may import `@/auth`. `npm run check:bundle` fails when the entry chunk
or a public route can reach the SDK, and when the chunk exceeds 80 KB gzipped (Auth only).

Configuration comes from `VITE_FIREBASE_*`; with `VITE_USE_AUTH_EMULATOR=true` the module connects
to the Auth emulator on `127.0.0.1:9099` and needs no real project.

## Persistence

Browser local persistence (the SDK default: IndexedDB, falling back to localStorage). The session
survives reloads and is shared between tabs. Trade-off: script injected into the page could read
it; the CSP (BEU-ICT/certificate-manager#385) limits that. Our code never copies tokens elsewhere, logs credentials or puts
them in URLs.

## OIDC provider (on-prem)

`VITE_AUTH_PROVIDER=firebase|oidc` is read at build time (default `firebase`). `vite.config.ts`
swaps `selected-backend.ts` for `selected-backend.oidc.ts`, so an OIDC build contains no Firebase
code and `check:bundle` (run with the same env var) fails if any leaks in. The public interface and
`useAuth()` are identical; differences:

- `signIn(email, password, returnTo)` redirects to the identity provider (authorization code +
  PKCE, no implicit flow; `email` is only a `login_hint`). The login page shows one SSO button.
- The IdP redirects back to `/auth/callback` (`admin/AuthCallbackPage`), which calls
  `completeSignIn()` and continues to the validated return path; `RequireAdmin` then checks the
  admin role through the API as usual.
- `sendPasswordReset` is a no-op (the IdP owns passwords); `signOut` ends the IdP session too.
- `getIdToken` returns the OIDC **ID token** (audience = client id), renewed silently by
  `oidc-client-ts` (refresh token, else hidden iframe); `forceRefresh` renews it now.
- Tokens are kept in `sessionStorage` (library default): per tab, gone when the tab closes, never in
  localStorage or URLs.
- Config: `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, optional `VITE_OIDC_SCOPE`. Register
  `<origin>/auth/callback` as redirect URI and `<origin>/login` as post-logout URI.
