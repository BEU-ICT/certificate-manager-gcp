# Configuration matrix

Every variable validated at boot (issue BEU-ICT/certificate-manager#236 §6, `api/.env.example`). Non-secret values are Cloud Run environment variables set by `infra/deploy-api.sh` from `infra/.env`; secrets come from Secret Manager (`--set-secrets`). **Any change creates a new Cloud Run revision** (deploy again). Who can change: project owners and the operator running the deployment script; secrets only principals with Secret Manager admin (owners).

| Variable                                                          | Kind       | Production value source                                                               |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                        | env        | `production` (fixed in the image and the deploy script)                               |
| `PORT`                                                            | env        | injected by Cloud Run (8080)                                                          |
| `LOG_LEVEL`                                                       | env        | `info`; temporarily `debug` during incidents                                          |
| `GCP_PROJECT`                                                     | env        | `PROJECT_ID`                                                                          |
| `SERVICE_URL`                                                     | env        | the Cloud Run service URL, recorded after the first deploy (OIDC audience)            |
| `PUBLIC_BASE_URL`                                                 | env        | `https://<project>.web.app` (or the custom domain)                                    |
| `PDF_PUBLIC_BASE_URL`                                             | env        | `https://storage.googleapis.com/<project>-pdfs`                                       |
| `TEMPLATES_BUCKET`                                                | env        | `<project>-templates`                                                                 |
| `PDF_BUCKET`                                                      | env        | `<project>-pdfs`                                                                      |
| `TASKS_QUEUE`                                                     | env        | `email-queue`                                                                         |
| `TASKS_LOCATION`                                                  | env        | `us-east1`                                                                            |
| `TASKS_INVOKER_SA`                                                | env        | `tasks-invoker@<project>.iam.gserviceaccount.com`                                     |
| `BOOTSTRAP_ADMIN_EMAIL`                                           | env        | owner's email, placeholder in `infra/.env` (consumed once by the bootstrap migration) |
| `EMAIL_PROVIDER` / `EMAIL_FALLBACK_PROVIDER`                      | env        | `gmail` / `brevo` (BEU-ICT/certificate-manager#364)                                   |
| `EMAIL_API_KEY`                                                   | **secret** | Secret Manager `EMAIL_API_KEY` (Brevo API key)                                        |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`         | env        | sender identity of the Workspace domain, chosen by the owner                          |
| `EMAIL_DAILY_CAP`                                                 | env        | `300` (below the provider daily limit)                                                |
| `EMAIL_FALLBACK_DAILY_CAP`                                        | env        | `300` (cap of the fallback provider)                                                  |
| `RATE_LIMIT_PUBLIC_PER_MIN`                                       | env        | `10` (default)                                                                        |
| `RATE_LIMIT_ADMIN_PER_MIN`                                        | env        | `60` (allowed 30-100)                                                                 |
| `TEMPLATE_CACHE_MB`                                               | env        | `40` (default; template asset cache budget, 1-256)                                    |
| `STATS_CACHE_SECONDS`                                             | env        | `60` (default; per-instance cache of `GET /api/v1/admin/stats`, 0-3600, 0 = off)      |
| `PDF_MAX_CONCURRENT_RENDERS`                                      | env        | `3` (default; concurrent PDF renders per instance, 1-16)                              |
| `PDF_RENDER_TIMEOUT_MS`                                           | env        | `30000` (default; per-render timeout, 1000-120000)                                    |
| `DB_ADAPTER`, `STORAGE_ADAPTER`, `QUEUE_ADAPTER`, `AUTH_PROVIDER` | env        | `firestore`, `gcs`, `cloud-tasks`, `firebase`                                         |
| `FEATURE_*`                                                       | env        | flags per `api/src/flags.ts`; unknown flags fail boot                                 |

## Rules

- No secret in env files, images, logs or CI. `infra/.env` is git-ignored and holds only non-secret values and placeholders.
- Only `certificates-api-runtime` can read `EMAIL_API_KEY` (binding on the secret, not the project; see `infra/iam.md`).
- Gmail needs no secret (keyless domain-wide delegation). If that spike fails, a `GMAIL_SA_KEY` secret may be created **only** after an ADR explains why.

## Rotation

1. Add a new secret version: `printf %s "$KEY" | gcloud secrets versions add EMAIL_API_KEY --data-file=-`.
2. Deploy a new revision (`infra/deploy-api.sh`) so it picks up `latest`.
3. Verify sending works, then disable the old version: `gcloud secrets versions disable <n> --secret EMAIL_API_KEY`.

The rotation procedure has not been tested yet (needs the live project). Review of this matrix by a second person is pending.

## Brevo fallback (BEU-ICT/certificate-manager#373)

`EMAIL_FALLBACK_PROVIDER=brevo` takes effect only with `FEATURE_EMAIL_FALLBACK=true`; `EMAIL_API_KEY` is then the Brevo API key (header `api-key`, never logged). Brevo needs the sending domain authenticated (DKIM/SPF) before use; this has not been verified against a live account. `sendgrid` is a reserved future provider name (no adapter yet).

Locally use `EMAIL_PROVIDER=gmail` (in-memory fake); `EMAIL_PROVIDER=brevo` with a key calls the real Brevo API.
