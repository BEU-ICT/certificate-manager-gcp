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
