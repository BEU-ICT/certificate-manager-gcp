# Email queue (Cloud Tasks)

Queue `email-queue` in `us-east1`, created by `infra/08-queue.sh` (idempotent, updates an existing queue).

| Setting                       | Value                         | Reason                                           |
| ----------------------------- | ----------------------------- | ------------------------------------------------ |
| `max-attempts`                | 5                             | bounded retries, a poison task cannot loop       |
| `min-backoff` / `max-backoff` | 10 s / 3600 s                 | spec §9                                          |
| `max-doublings`               | 4                             | 10, 20, 40, 80 s, then linear up to the cap      |
| `max-dispatches-per-second`   | 1                             | below provider limits (about 1 email per second) |
| `max-concurrent-dispatches`   | 2                             |                                                  |
| `max-retry-duration`          | unlimited (attempts bound it) |                                                  |
| per-task `dispatchDeadline`   | 55 s, set by the adapter      | below the Cloud Run request timeout of 60 s      |

Tasks carry an OIDC token of `tasks-invoker` with audience `SERVICE_URL`. Cost: five thousand emails per month is far below the 1 M operations/month free tier (`docs/cost-model.md`).

Caveat: Cloud Tasks does not accept a task name used within roughly the last hour, which affects resends (naming scheme in BEU-ICT/certificate-manager#366).

## Daily cap and rescheduling

The handler counts sent e-mails per provider and UTC day in Firestore (`email_counters/<provider>:<YYYY-MM-DD>`, TTL on `expiresAt`) against `EMAIL_DAILY_CAP` (default 300). Over the cap it uses the fallback provider (only when `EMAIL_FALLBACK_PROVIDER` is set and `FEATURE_EMAIL_FALLBACK` is on; own cap `EMAIL_FALLBACK_DAILY_CAP`, default 300) or enqueues a new task `email-<id>-<n>-r<k>` scheduled for next UTC midnight + 5 min + 0 to 30 min jitter. After three reschedules the certificate is marked `failed` (`DAILY_CAP_EXHAUSTED`) and can be resent from the admin UI. Reschedule tasks appear in `gcloud tasks list` with a future schedule time; do not purge them unless the e-mails must not be sent.

## Provider fallback

With `EMAIL_FALLBACK_PROVIDER=brevo` and `FEATURE_EMAIL_FALLBACK=true`, a `QuotaExceededError` from the primary (provider 429) is retried on the fallback provider in the same attempt, with the same Message-ID. Permanent, configuration and transient errors are not redirected (transient ones are retried by Cloud Tasks). Logs name the provider, never addresses. Details and caveats (counter accounting, unverified DKIM) are in `api/src/modules/notifications/README.md`.

## Incident procedures

```bash
gcloud tasks queues pause email-queue --location=us-east1     # stop dispatching, keep tasks
gcloud tasks queues resume email-queue --location=us-east1
gcloud tasks queues purge email-queue --location=us-east1     # drop all pending tasks (irreversible)
gcloud tasks list --queue=email-queue --location=us-east1
```

Pause first when a provider is down or a bad template is sending; purge only after deciding the emails must not be sent (affected certificates stay `emailStatus=pending`/`failed` and can be resent from the admin UI).

## Not yet verified (needs the live project)

`gcloud tasks queues describe` shows the exact settings, and a test task to the protected test endpoint (BEU-ICT/certificate-manager#368) is delivered with an OIDC token whose audience equals `SERVICE_URL`.

## Manual verification of the Cloud Tasks adapter (BEU-ICT/certificate-manager#366)

The adapter is covered by unit tests with a mock client; the checks below need the live project and are run once after the first deployment (`QUEUE_ADAPTER=cloud-tasks`, `TASKS_QUEUE=email-queue`, `TASKS_LOCATION=us-east1`):

1. Enqueue a test task named `email-<testId>-1` (admin resend or the test endpoint of BEU-ICT/certificate-manager#368).
2. `gcloud tasks describe email-<testId>-1 --queue=email-queue --location=us-east1` shows `httpRequest.url` = `${SERVICE_URL}/internal/tasks/send-email`, `httpMethod: POST`, `oidcToken.serviceAccountEmail` = `TASKS_INVOKER_SA`, `oidcToken.audience` = `SERVICE_URL` (no trailing slash), `dispatchDeadline: 55s`.
3. The request reaches Cloud Run with a valid OIDC token (the task request verifier accepts it; the task ends in status 2xx in the logs).
4. Enqueue the same name again while the task is pending or within about one hour after it ran: `enqueue` returns `{ created: false }` and no second task or delivery appears (`gcloud tasks list`).
5. Enqueue `email-<testId>-2`: a second task is created (resend naming).
6. A task with `scheduleAt` 2 minutes ahead shows the matching `scheduleTime` and is dispatched not earlier.
7. Payload check: the task body contains only `certificateId` and `sequence` (no address or name).
