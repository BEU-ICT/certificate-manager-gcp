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
