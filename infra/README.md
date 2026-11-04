# infra

Repo-side infrastructure for the GCP project: idempotent gcloud/firebase scripts, `firebase.json`, Firestore rules and indexes, Cloud Run service YAML. Deployment is manual (ADR 0011); nothing here runs in CI.

All scripts source `lib.sh`, read settings from `infra/.env` (copy `.env.example`; git-ignored) and support `DRY_RUN=1`, which prints every gcloud command instead of running it. Review a dry run before the real one. Region is `us-east1` (ADR 0015).

## Order of execution

Run the numbered scripts in order, as a person with Billing Account Administrator and Owner rights:

| Step | Script                  | What it does                                                                                            |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| 1    | `01-project.sh`         | create project, link billing, add Firebase (Blaze), grant Owner to `OWNER_EMAILS` (at least two humans) |
| 2    | `02-budget.sh`          | **before anything else**: $1 and $5 budgets with 50/90/100 % alerts, e-mail to `BUDGET_EMAILS` (>= 2)   |
| 3    | `03-apis.sh`            | enable the 17 APIs of spec §12 and verify them                                                          |
| 4    | `check-org-policies.sh` | read-only: effective org policies that could block the design (`docs/org-policies.md`)                  |

Further steps, in order: `04-firestore.sh` (database, rules, indexes), `05-buckets.sh` (+ `verify-iam.sh`), `06-backups.sh`, `07-iam.sh`, `08-queue.sh`, `09-secrets.sh`, then `deploy-all.sh` (see `docs/runbook.md`). Details: `docs/firestore.md`, `docs/storage.md`, `docs/backup-restore.md`, `iam.md`, `docs/email-queue.md`, `docs/config-matrix.md`, `docs/cloud-run.md`, `docs/hosting.md`.

```bash
cp infra/.env.example infra/.env   # fill PROJECT_ID, BILLING_ACCOUNT_ID, emails
DRY_RUN=1 infra/01-project.sh      # review
infra/01-project.sh && infra/02-budget.sh && infra/03-apis.sh
```

Self-tests without cloud access (run in CI): `infra/test-dry-run.sh`, `infra/test-smoke.sh`.

## Rules for scripts

- Idempotent: check existence first, use `add-iam-policy-binding`, never delete.
- No service-account keys, no secrets in files; placeholders only.
- Nothing that bills at idle (no load balancer, Cloud NAT, always-on instance).

## Related documents

`docs/budget-alerts.md`, `docs/cost-model.md`, `docs/org-policies.md`, `docs/adr/0015-region-and-residency.md`.
