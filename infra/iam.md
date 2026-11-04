# IAM

Source of truth for every binding of the application service accounts. `infra/iam-expected.txt` is the machine-readable twin; `infra/check-iam.sh` diffs it against the live project (read-only). Apply with `infra/07-iam.sh`, `08-queue.sh`, `09-secrets.sh` and `deploy-api.sh`. **No service-account keys exist or are created** (org policy `iam.disableServiceAccountKeyCreation` may stay enforced); no service account has `owner` or `editor`.

## Service accounts

| Account                    | Used by                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `certificates-api-runtime` | identity of the Cloud Run service `certificates-api`                                             |
| `tasks-invoker`            | identity of the OIDC token Cloud Tasks attaches to `/internal/**` calls (audience `SERVICE_URL`) |
| `scheduler-invoker`        | identity of Cloud Scheduler jobs (#162)                                                          |

## Bindings

| Member              | Role                                   | On                           | Why / flow                                                                                        |
| ------------------- | -------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| runtime             | `roles/datastore.user`                 | project                      | read/write Firestore through the Admin SDK                                                        |
| runtime             | `roles/firebaseauth.admin`             | project                      | **spec delta** create the bootstrap admin, set custom claims, generate password-setup links (#68) |
| runtime             | `roles/storage.objectAdmin`            | bucket `<project>-templates` | read templates, upload template files                                                             |
| runtime             | `roles/storage.objectAdmin`            | bucket `<project>-pdfs`      | write and delete PDFs (revocation, ADR 0007)                                                      |
| runtime             | `roles/cloudtasks.enqueuer`            | queue `email-queue`          | enqueue email tasks                                                                               |
| runtime             | `roles/secretmanager.secretAccessor`   | secret `EMAIL_API_KEY`       | read the email provider key (per secret, never project-wide)                                      |
| runtime             | `roles/iam.serviceAccountUser`         | SA `tasks-invoker`           | **spec delta** attach the invoker's OIDC identity to tasks                                        |
| runtime             | `roles/iam.serviceAccountTokenCreator` | itself                       | **spec delta** keyless domain-wide delegation for Gmail (#151)                                    |
| `tasks-invoker`     | `roles/run.invoker`                    | service `certificates-api`   | keeps the OIDC path valid if ingress is tightened (the service is public)                         |
| `scheduler-invoker` | `roles/run.invoker`                    | service `certificates-api`   | same, for scheduled jobs                                                                          |
| `allUsers`          | `roles/run.invoker`                    | service `certificates-api`   | Hosting reaches Cloud Run unauthenticated; `/internal/**` enforces OIDC itself (#149)             |
| `allUsers`          | `roles/storage.legacyObjectReader`     | bucket `<project>-pdfs`      | public PDFs without listing (ADR 0005)                                                            |

## Periodic review

Every quarter and after any role change: run `infra/check-iam.sh`, review `gcloud projects get-iam-policy` for new members, remove stale human owners, confirm no keys exist (`gcloud iam service-accounts keys list --iam-account <sa> --managed-by=user` is empty). The runbook (#60) lists this as a recurring item.

## Not yet verified (needs the live project)

`check-iam.sh` output on the real project, and the acceptance test that a deployment using only the runtime account can create a user, write Firestore, put/delete a PDF and enqueue a task.
