# auth

The only module allowed to import the Firebase SDK (ESLint `no-restricted-imports` for static
imports plus `no-restricted-syntax` for dynamic `import()`, with negative fixtures in
`scripts/eslint-firebase.test.mjs`). A different OIDC provider can replace it later (#208) without
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
it; the CSP (#166) limits that. Our code never copies tokens elsewhere, logs credentials or puts
them in URLs.
