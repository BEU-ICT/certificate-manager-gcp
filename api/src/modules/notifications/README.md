# notifications

E-mail delivery of certificates (ADR 0009). Status: scaffold, the implementation follows in the notifications epic; the interface below is the intended contract.

## Responsibility

Send the certificate e-mail through the `EmailSender` port with provider fallback, retry and a daily cap, and record the outcome on the certificate (`emailStatus`, `emailAttempts`, `emailSentAt`, `emailLastError`). Never log addresses or names.

## Public interface

- Service methods: enqueue e-mail for a certificate, handle the send task (called by an `/internal/**` route), resend.
- Events published: none.
- Events consumed: `certificate.issued` (enqueue the e-mail), `certificate.revoked` (stop pending sends).
- Ports used: `EmailSender`, `TaskQueue`, `Scheduler`, `CertificateRepository` (through the `certificates` service), `Clock`.

## Owned data

No collection of its own; it updates the e-mail fields of `certificates` through the `certificates` service. Daily cap counters use `RateLimiter` storage.

## Non-goals

Issuing and revoking certificates (see `certificates`) and rendering PDFs (see `pdf`).

## Enqueue on issuance (BEU-ICT/certificate-manager#367)

`registerIssuedEmailSubscriber` (`issued-email-subscriber.ts`) is registered in `src/compose.ts` and handles `certificate.issued`:

1. `hasEmail=false`: nothing happens (no reservation, no task).
2. `certificates.reserveEmailSend(id)` atomically increments `emailAttempts` to `n` (one Firestore transaction: one read, one write).
3. Enqueue `{ name: email-<id>-<n>, handler: SEND_EMAIL_HANDLER, payload: { certificateId, sequence: n }, dedupe: true }`. The event is published after the certificate is committed.
4. If the queue refuses the task: `markEmailFailed(id, 'ENQUEUE_FAILED')` (`emailStatus=failed`, `emailLastError=ENQUEUE_FAILED`) and an ERROR log with the certificate ID and the error class name only. The admin sees `failed` and can resend. The handler never throws, so issuance is unaffected.

Idempotency under duplicate delivery: the first-send reservation only succeeds for an `active` certificate with `emailStatus=pending` and `emailAttempts=0`. A duplicate event finds `emailAttempts>=1`, `reserveEmailSend` returns `null` and nothing is enqueued, so there is exactly one task (and no second name `-2`). Task-name dedupe (`dedupe: true`) is the second safety net. A resend uses `reserveEmailSend(id, { resend: true })`, which always increments and so gets a new name.

Known gap: if the process dies between the reservation and the enqueue, the certificate stays `pending` with `emailAttempts=1` and no task; a duplicate event will not repair it (by design, to keep duplicates harmless). The admin resend (or a later reconciliation job) covers it. If the store itself fails during the reservation, the error is logged (ID only) and the certificate stays `pending`.

The module depends on certificates only through the structural interface `EmailCertificateState`, satisfied by `Services.certificates`.

## Send handler (BEU-ICT/certificate-manager#368)

`POST /internal/tasks/send-email` (`src/http/routes/internal-send-email.ts`) is called by Cloud Tasks only. It is not under `/api/v1`, hidden from OpenAPI, outside the admin guard and the public limiter, and has its own per-IP limiter (600/min, key `internal-tasks:ip:<hash>`). Order: limiter, then `TaskRequestVerifier` (`onRequest`, so before body parsing and any database access), then the strict body `{ certificateId, sequence }` (unknown fields: 400), then `createSendEmailHandler` (`send-email-handler.ts`). All responses have empty bodies.

Verifier: `GoogleTaskRequestVerifier` (`src/adapters/google/task-request-verifier.ts`, wired by `AUTH_PROVIDER=firebase`) accepts only `Authorization: Bearer <JWT>` verified by `google-auth-library` for audience `SERVICE_URL`, Google issuer, `email_verified` and `email == TASKS_INVOKER_SA`; anything else (including an unset `TASKS_INVOKER_SA`) is 401 with no details, the reason code only goes to the log.

Handler decisions, in order: certificate missing/malformed ID, not `active`, no e-mail, `sequence < emailAttempts` (superseded by a resend) or `emailStatus != pending` (sent, failed, skipped): 200, nothing happens. Otherwise the daily cap (optional `DailyCap` seam) and the message (`MessageComposer` seam) are applied and `EmailSender.send` is called with Message-ID `<cm-<id>-<sequence>@<from domain>>` (stable per task, so a repeated send is deduplicable).

| Result                                                   | Status change                                                                                                   | HTTP                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------- |
| sent                                                     | `sent`, `emailSentAt`, `emailLastError` cleared                                                                 | 200                  |
| `PermanentEmailError`                                    | `failed`, `REJECTED: <CODE>` (the error message if it is an upper-case code, else `PERMANENT`; never free text) | 200                  |
| `TransientEmailError`, `QuotaExceededError`, cap reached | none; with `X-CloudTasks-TaskRetryCount >= 4` (5th attempt) `failed` / `RETRIES_EXHAUSTED`                      | 500 (200 on the 5th) |
| `ConfigurationError`                                     | none (CRITICAL log, `fatal`)                                                                                    | 500                  |

Statuses only move `pending -> sent|failed`; `failed -> pending` is a resend. Delivery is at-least-once: a crash after the provider accepted the message but before `markEmailSent` repeats the send, which the stable Message-ID makes harmless for providers and mailboxes that deduplicate. A concurrent resend between the check and the update is not guarded by a transaction (accepted; the admin sees the final state).

In-process queue (`QUEUE_ADAPTER=in-process`): `compose.ts` builds one handler and registers `createInProcessSendEmailTask(handler)` under `SEND_EMAIL_HANDLER` in `inProcessTaskHandlers`; `server.ts` passes the same handler to the route. The in-process queue retries on a thrown error and has no retry-count header, so the adapter keeps a per-task retry counter (lost on restart) and throws `SendEmailRetryError` for `retry`/`misconfigured` outcomes; on the 5th attempt the shared logic marks `RETRIES_EXHAUSTED`. Invalid payloads are dropped.

Left for the other tasks: the daily cap (BEU-ICT/certificate-manager#374) is only the `DailyCap` interface and is not wired (no cap applies), the localised template (BEU-ICT/certificate-manager#376) is only `PlainMessageComposer` (plain az/en text and escaped HTML), and the provider fallback (`Ports.emailFallback`) is not used by the handler yet.

## Admin resend (BEU-ICT/certificate-manager#377)

`POST /api/v1/admin/certificates/{id}/resend-email` (`src/http/routes/admin-certificate-resend-email.ts`, service `DefaultEmailResendService` in `resend.ts`, exposed as `Services.emailResend`). Body `{ email? }`, strict; the address is validated and lowercased with the issuance `emailSchema`. Response `202 { emailStatus: "pending", emailAttempts }`.

Order of work:

1. Throttle: `RateLimiter.consume("email-resend:<certificateId>", 5 per 24 h)`, else `429 RATE_LIMITED` with `Retry-After`. Every attempt that passes ID validation counts, including attempts later refused with 409/422 (keeps the check to the limiter and avoids a second read). With the in-process limiter the counter is per instance and lost on restart (effective limit 5 x instances); a shared `RateLimiter` adapter would make it exact.
2. `certificates.prepareEmailResend` = `CertificateRepository.prepareEmailResend`, one transaction (one read, one write), so concurrent resends cannot both pass: unknown ID `404`; not `active` `409 CONFLICT` (detail `CERTIFICATE_REVOKED`); no stored or supplied address `422 EMAIL_REQUIRED`; `pending` with `updatedAt` newer than 2 hours `409 CONFLICT` (detail `EMAIL_IN_PROGRESS`). Otherwise it stores the address, sets `pending`, clears `emailLastError` and increments `emailAttempts`. Allowed for `failed`, `sent`, `skipped` and a `pending` older than 2 hours.
3. Enqueue `email-<id>-<emailAttempts>` (`dedupe: true`). A resend always gets a new number, so it never collides with Cloud Tasks' roughly one hour name reuse block. A `skipped` certificate (0 attempts) therefore gets sequence 1, exactly like a first send. If the queue refuses the task: the certificate is marked `failed` / `ENQUEUE_FAILED` and the route answers `503 UNAVAILABLE` (the address change is kept; the admin retries).
4. A changed address is logged as `audit` action `certificate.email_changed` (entity ID and admin UID only, never addresses).

The send worker ignores superseded tasks (`sequence < emailAttempts`), so an older queued task cannot send after a resend.
