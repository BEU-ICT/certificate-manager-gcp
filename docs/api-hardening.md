# API hardening

Implemented in `api/src/http/security.ts`, `api/src/app.ts` and `api/src/http/error-handler.ts` (BEU-ICT/certificate-manager#384).

## Response headers (every response, including errors, 404s and redirects)

`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `X-Frame-Options: DENY`, a minimal `Permissions-Policy`. `X-Powered-By` and `Server` are removed. A plain hook is used instead of `@fastify/helmet` (no new dependency or lockfile change; seven header writes per response).

`Cache-Control` defaults to `no-store`; routes choose their own (`no-cache` for public lookups, `no-store` for admin responses and PDF redirects).

## CORS

No CORS plugin: the SPA and the API share an origin behind Hosting. `OPTIONS` (preflight) answers 404 everywhere and no `Access-Control-*` header is ever sent.

## Limits

| Limit                        | Value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| Body (global, bulk issuance) | 1 MB, `413 PAYLOAD_TOO_LARGE`                               |
| Template upload              | 10 MB (+ multipart overhead)                                |
| Headers                      | 16 KB (Node rejects larger with 431)                        |
| URL                          | 2048 characters, `414 URI_TOO_LONG`                         |
| Path parameter               | 128 characters; longer is answered like an unknown ID (404) |
| Connection / request timeout | 55 s                                                        |
| Keep-alive                   | 65 s (above Google's front end)                             |

JSON uses Fastify's secure parser (a `__proto__` key is rejected with 400); unsupported content types answer `415 UNSUPPORTED_MEDIA_TYPE`.

## Checking a deployment

```bash
scripts/check-headers.sh https://<hosting-origin>
```

Trust of `X-Forwarded-*` is decided in BEU-ICT/certificate-manager#388.
