# web

React + Vite + TypeScript SPA, deployed to Firebase Hosting. Tailwind CSS 4, React Router, i18next.

## Scripts

| Script                 | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `npm run dev`          | Dev server on :5173, proxies `/api/v1` to `http://localhost:8080`       |
| `npm run build`        | Typecheck, build to `web/dist`, then run `check:bundle`                 |
| `npm run analyze`      | Build and write a gzip treemap to `web/dist/stats.html`                 |
| `npm run check:bundle` | After a build: fails if the Firebase SDK leaks outside the admin bundle |
| `npm run lint`         | ESLint (typed rules, Firebase import restriction)                       |
| `npm run typecheck`    | `tsc --noEmit`                                                          |

Copy `.env.example` to `.env.local` for the public Firebase web config.

## Structure

- `src/router.tsx`: route table. `/c/:id`, `/login`, `/admin/*` and the landing page are
  route-level `React.lazy` chunks; the root chunk holds only the router, layout and the 404 page.
- `src/auth/`: the only module that may import the Firebase SDK (ESLint-enforced); it is reached
  only from admin code, so Firebase ships in its own chunk next to the admin bundle.
- `src/admin/`: admin area (login, protected routes, screens).
- `src/pages/`: public pages.
- `@/` aliases `src/`.

No CORS is configured anywhere: in production Firebase Hosting rewrites `/api/v1` to Cloud Run
(same origin), in development Vite proxies it.
