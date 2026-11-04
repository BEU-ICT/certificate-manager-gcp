# 0009 E-mail through `EmailSender` (Gmail primary, Brevo fallback, Cloud Tasks)

Status: accepted · Spec §2 · Issue #16 §6, §10

## Context

Certificates are e-mailed to recipients. Sending can fail or be rate limited, and a request must not wait for it.

## Decision

The `notifications` module sends mail through the `EmailSender` port with typed errors. The primary adapter is the Gmail API on the organisation's Google Workspace domain using keyless domain-wide delegation; Brevo is the fallback (`EMAIL_PROVIDER`, `EMAIL_FALLBACK_PROVIDER`, `FEATURE_EMAIL_FALLBACK`). Sending is deferred: the issuing flow enqueues a task through the `TaskQueue` port (Cloud Tasks, at-least-once, named de-duplication), and an `/internal/**` handler sends the message and records the outcome on the certificate. A daily cap (`EMAIL_DAILY_CAP`) applies. E-mail language follows the event (`az` default, `en`). No addresses or names go into logs.

## Consequences

- Handlers must be idempotent because delivery is at-least-once.
- Provider changes (SMTP on-prem, others) need only an adapter.
- Bounce handling is optional behind `FEATURE_BOUNCE_JOB`.
