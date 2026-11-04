# Runbook: manual deployment, rollback and incidents

Deployment is manual (ADR 0011). Everything here is repeatable from a clean machine. The first-time setup of the project is in `infra/README.md`. **Status:** written offline; the "second team member" walk-through (deploy + rollback on the live project) is pending and its notes are to be merged here.

## Prerequisites

- Node.js per `.nvmrc`, npm, `git`, `curl`, `python3`.
- Google Cloud CLI (`gcloud`, a current release) and Firebase CLI (`npm i -g firebase-tools`, major 15 or newer).
- Roles: project Owner (or equivalent Cloud Run, Hosting and Firestore admin rights).
- `infra/.env` filled from `infra/.env.example` (non-secret values, `EXPECTED_PROJECT_ID` set to the production project id).

## Authenticate

```bash
gcloud auth login
gcloud config set project "$PROJECT_ID"
firebase login
```

No service-account keys are used for operators or CI.

## Deploy

All deploy scripts refuse to run on a dirty tree, off `dev` or a release tag, with a project that differs from `EXPECTED_PROJECT_ID`, or with failing tests (unless `--skip-checks`), and ask you to type the project id. `DRY_RUN=1` prints the commands only.

| What                                                            | Command                 |
| --------------------------------------------------------------- | ----------------------- |
| Everything, in order (rules/indexes, API, web, smoke test, tag) | `infra/deploy-all.sh`   |
| Rules and indexes only                                          | `infra/deploy-rules.sh` |
| API only                                                        | `infra/deploy-api.sh`   |
| SPA only                                                        | `infra/deploy-web.sh`   |

Order matters: rules/indexes first (new indexes need minutes to build), API second, web last. First deployment: run `infra/deploy-api.sh` twice (the second run sets `SERVICE_URL`, see `docs/cloud-run.md`).

## Smoke test

```bash
SMOKE_CERT_ID=<known certificate id> infra/smoke-test.sh https://<project>.web.app https://<cloud-run-url>
```

Checks: Cloud Run `/internal/healthz` is 200; the SPA index is served by Hosting; public details return 200 without an `email` key; an unknown id returns 404 in the JSON error shape; `/api/v1/admin/me` without a token returns 401; `/internal/**` is not served through Hosting. Exit code is non-zero if any check fails (`infra/test-smoke.sh` proves this offline against a fake broken deployment). `deploy-all.sh` creates the tag `vYYYY.MM.DD-N` (`infra/tag-release.sh`) only after the smoke test passes; push it with `git push origin <tag>`.

## Rollback

| Part              | Command                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| API               | `infra/rollback.sh revisions`, then `infra/rollback.sh api <revision>` (100 % traffic to the previous revision; no rebuild)                  |
| SPA               | `firebase hosting:rollback --project "$PROJECT_ID"`                                                                                          |
| Rules and indexes | check out the previous release tag in a clean clone and run `infra/deploy-rules.sh --skip-checks`                                            |
| Data migrations   | forward-only and idempotent: they are never rolled back. Fix forward with a new migration, or restore from backup (`docs/backup-restore.md`) |

Roll back the API first when both changed, then re-run the smoke test.

## Incident checklist

1. Assess: Cloud Run logs and error rate (`gcloud run services logs read certificates-api --region us-east1 --limit 100`), Firestore usage in the console.
2. Stop the bleeding: pause the email queue (`gcloud tasks queues pause email-queue --location=us-east1`, `docs/email-queue.md`); turn off a feature with its `FEATURE_*` flag (for example `FEATURE_PUBLIC_PDF_GENERATION=false`, then deploy; config change creates a new revision); lower `--max-instances` to cap cost.
3. Abuse: revoke offending certificates in the admin UI (the PDF is removed), tighten `RATE_LIMIT_PUBLIC_PER_MIN`.
4. Roll back the faulty release (above).
5. Cost alert received: `docs/cost-model.md`, "If a quota is exceeded".
6. Record what happened and the fix in an issue.

## Recurring checks

Quarterly: `infra/check-iam.sh` and the IAM review in `infra/iam.md`; confirm a recent backup exists and run `infra/restore-drill.sh`; re-check free-tier limits (`docs/cost-model.md`).

## Who to call

Project owners (see the private operator notes; names and phone numbers are not kept in this repository). Escalation for billing: the billing administrators of the university billing account.
