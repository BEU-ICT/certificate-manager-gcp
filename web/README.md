# web

React + Vite + TypeScript SPA, deployed to Firebase Hosting. Tailwind CSS 4, React Router, i18next.

## Scripts

| Script                    | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`             | Dev server on :5173, proxies `/api/v1` to `http://localhost:8080`       |
| `npm run build`           | Typecheck, build to `web/dist`, then run `check:bundle`                 |
| `npm run analyze`         | Build and write a gzip treemap to `web/dist/stats.html`                 |
| `npm run check:bundle`    | After a build: fails if the Firebase SDK leaks outside the admin bundle |
| `npm run lint`            | ESLint (typed rules, Firebase import restriction)                       |
| `npm run typecheck`       | `tsc --noEmit`                                                          |
| `npm run test:unit`       | Vitest (jsdom) + Testing Library + axe + MSW                            |
| `npm run test:coverage`   | Unit tests with a v8 coverage report (`coverage/`)                      |
| `npm run test:e2e`        | Playwright smoke suite (`e2e/`); starts the API and Vite itself         |
| `npm run api:types`       | Regenerate `src/api/schema.d.ts` from `../api/openapi.json`             |
| `npm run api:types:check` | Regenerate and fail if `git diff` is not empty (CI, wired by #41)       |
| `npm run i18n:check`      | Fails on keys missing in a language, used-but-missing or unused keys    |

Copy `.env.example` to `.env.local` for the public Firebase web config.

## Structure

- `src/router.tsx`: route table. `/c/:id`, `/login`, `/admin/*` and the landing page are
  route-level `React.lazy` chunks; the root chunk holds only the router, layout and the 404 page.
- `src/auth/`: the only module that may import the Firebase SDK (ESLint-enforced); it is reached
  only from admin code, so Firebase ships in its own chunk next to the admin bundle.
- `src/admin/`: admin area: `/login` and `/login/forgot-password` (react-hook-form + zod, no registration), post-login redirect validation (`redirect.ts`), API/auth wiring (`session.ts`), the `RequireAdmin` guard and the lazily loaded admin screens (`AdminRoutes.tsx`, fetched only after `GET /api/v1/admin/me` succeeded).
- `src/pages/`: public pages.
- `src/i18n/`, `src/locales/{az,en}/{common,admin,public,errors}.json`: i18next with a lazy
  per-file backend (only the active language is downloaded). Language: stored choice, `?lang`,
  `navigator.language`, `az`. Dynamic keys go in the allow-list in `scripts/i18n-check.mjs`.
- `src/lib/certificateTypes.ts` duplicates the API's certificate type registry (#16 section 5).
- `src/components/`: design primitives (Tailwind 4 tokens in `src/index.css` `@theme`, Inter variable
  font self-hosted). `src/layouts/`: `PublicLayout`, `AdminLayout` (language switcher is a slot).
  In `npm run dev`, `/admin/_components` shows every component; it is compiled out of production.
- `@/` aliases `src/`.

No CORS is configured anywhere: in production Firebase Hosting rewrites `/api/v1` to Cloud Run
(same origin), in development Vite proxies it.

## API client

`src/api/`: typed `fetch` wrapper for `/api/v1` (`createApiClient`), `ApiError`, TanStack Query defaults and `ApiProvider`. `src/admin/session.ts` calls `configureApi({ getToken, onUnauthorized })` with the auth module's `getIdToken`; a second 401 ends the session (`RequireAdmin`: sign out, drop the query cache, `/login` with an expiry notice); the Firebase SDK is never imported here. Tokens are only held by the auth module and sent in the `Authorization` header of `/admin/**` calls.

## Testing

- **Unit/component** (`src/**/*.test.{ts,tsx}`, Vitest + jsdom). Render with `renderWithProviders(ui, { route })` from `@/test/render` (router, TanStack Query without retries, i18n; tests assert on English strings). Tests of auth-dependent components mock `@/auth` with `fakeAuth` from `@/test/fakeAuth` (see `src/admin/RequireAdmin.test.tsx`).
- **API mocking**: call `setupMswServer()` from `@/test/server` in the test file and add handlers per test with `server.use(http.get('*/api/v1/...', ...))`. Unhandled requests fail the test.
- **Accessibility**: `await expectNoA11yViolations(container)` from `@/test/axe` (vitest-axe, WCAG rules; colour contrast is covered by the design tokens because jsdom has no layout). Use it in every page test.
- **E2E smoke** (`e2e/`, Playwright, Chromium): `playwright.config.ts` starts the API with in-process adapters (`DB_ADAPTER=memory`, no emulators needed) and the Vite dev server. First run: `npx playwright install chromium`. It runs in CI on merges to `dev` and nightly (`.github/workflows/e2e.yml`), not on every PR.
- **Sign-in e2e** (`e2e/admin-login.spec.ts`): the form and navigation tests run offline. The tests that actually sign in are skipped unless `E2E_AUTH_EMULATOR=true`, `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` are set; they need the Auth emulator (`npm run dev:emulators` at the repo root), the API started with `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, the web app started with `VITE_USE_AUTH_EMULATOR=true`, and an administrator with the `role=admin` claim (the seed script, #61, creates one). Use emulator-only test values, never real credentials.
