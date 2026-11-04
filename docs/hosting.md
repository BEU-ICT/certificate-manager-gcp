# Firebase Hosting

`firebase.json` (repository root) serves the SPA from `web/dist` and puts the API on the same origin, so no CORS is needed.

| Path            | Behaviour                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/**`    | rewritten to Cloud Run service `certificates-api` (`us-east1`)                                                                          |
| everything else | `index.html` (deep links such as `/c/abc` work)                                                                                         |
| `/internal/**`  | **not rewritten**: falls through to the SPA, so it is never exposed through the public domain; OIDC-protected on the Cloud Run URL only |
| `/api/v2/**`    | not configured; added when v2 exists (spec §8)                                                                                          |

Cache: `assets/**` (hashed files) `public, max-age=31536000, immutable`; `/` and `index.html` `no-cache`. Hosting does not cache rewrites to Cloud Run unless the response is cacheable, so **the API must send `Cache-Control: no-store` (or `no-cache`) explicitly** on its responses. Security headers come with #166 and the legacy redirect with #200.

Deploy: `firebase deploy --only hosting --project <project>` after `npm run build -w web` (script in #60).

`infra/test-dry-run.sh` asserts the rewrite order, the absence of `/internal` and `/api/v2` rewrites and the cache headers.

## Not yet verified (needs the live project)

`https://<project>.web.app/api/v1/...` reaches Cloud Run, `/internal/healthz` through Hosting returns the SPA or 404 and not the API, `/c/abc` serves `index.html`, response headers show the cache policy above.
