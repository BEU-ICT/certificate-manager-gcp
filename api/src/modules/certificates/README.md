# certificates

Issuing, verifying and revoking certificates. Status: scaffold, the implementation follows in the certificates epic; the interface below is the intended contract.

## Responsibility

Issue certificates (single and bulk), serve the public verification lookup, list and filter for administrators, and revoke (ADR 0010). Owns the certificate state and the public ID rules (`^(?:[A-Za-z0-9_-]{22}|[0-9a-f]{32})$`).

## Public interface

- Service methods: issue, issue bulk, get public, get admin, list, count, revoke.
- Events published: `certificate.issued`, `certificate.revoked` (payloads in `src/ports/event-bus.ts`).
- Events consumed: none.
- Ports used: `CertificateRepository`, `TemplateRepository` (through the `templates` service), `EventBus`, `RateLimiter`, `Clock`, `IdGenerator`.

## Owned data

Collection `certificates` with indexes `(type, issuedAt desc)`, `(status, issuedAt desc)` and `(emailStatus, issuedAt desc)`. The public lookup costs exactly one document read.

## Non-goals

PDF rendering and storage (see `pdf`) and e-mail delivery (see `notifications`); both react to the events above.
