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
| `npm run api:types`       | Regenerate `src/api/schema.d.ts` from `../api/openapi.json`             |
| `npm run api:types:check` | Regenerate and fail if `git diff` is not empty (CI, wired by #41)       |
| `npm run i18n:check`      | Fails on keys missing in a language, used-but-missing or unused keys    |

Copy `.env.example` to `.env.local` for the public Firebase web config.

## Structure

- `src/router.tsx`: route table. `/c/:id`, `/login`, `/admin/*` and the landing page are
  route-level `React.lazy` chunks; the root chunk holds only the router, layout and the 404 page.
- `src/auth/`: the only module that may import the Firebase SDK (ESLint-enforced); it is reached
  only from admin code, so Firebase ships in its own chunk next to the admin bundle.
- `src/admin/`: admin area (login, protected routes, screens).
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

`src/api/`: typed `fetch` wrapper for `/api/v1` (`createApiClient`), `ApiError`, TanStack Query defaults and `ApiProvider`. The auth module (#73) calls `configureApi({ getToken, onUnauthorized })`; the Firebase SDK is never imported here. Tokens are only held by the auth module and sent in the `Authorization` header of `/admin/**` calls.
