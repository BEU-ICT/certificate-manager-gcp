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

Caveat: Cloud Tasks does not accept a task name used within roughly the last hour, which affects resends (naming scheme in #147).

## Incident procedures

```bash
gcloud tasks queues pause email-queue --location=us-east1     # stop dispatching, keep tasks
gcloud tasks queues resume email-queue --location=us-east1
gcloud tasks queues purge email-queue --location=us-east1     # drop all pending tasks (irreversible)
gcloud tasks list --queue=email-queue --location=us-east1
```

Pause first when a provider is down or a bad template is sending; purge only after deciding the emails must not be sent (affected certificates stay `emailStatus=pending`/`failed` and can be resent from the admin UI).

## Not yet verified (needs the live project)

`gcloud tasks queues describe` shows the exact settings, and a test task to the protected test endpoint (#149) is delivered with an OIDC token whose audience equals `SERVICE_URL`.
