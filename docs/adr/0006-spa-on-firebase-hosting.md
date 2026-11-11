# 0006 React SPA on Firebase Hosting with `/api/v1` rewrite

Status: accepted · Spec §2 · Issue BEU-ICT/certificate-manager#236 §3, §7

## Context

The frontend is a static single-page app and the API is a separate Cloud Run service. The browser should see one origin to avoid CORS and to keep the public URL stable.

## Decision

`web/` (React, Vite, TypeScript, React Router) is deployed to Firebase Hosting. `firebase.json` rewrites `/api/v1/**` to the Cloud Run service in `us-east1` and falls back to `index.html` for client routes. The public verification route stays small (target 150 KB gzipped JS) and does not include the Firebase SDK; only the admin routes load it.

## Consequences

- Same-origin API calls, no CORS configuration for the SPA.
- Hosting adds one hop and its own caching rules, which `firebase.json` must set explicitly for API paths.
- The UI ships in `az` (default) and `en`, checked in CI.
