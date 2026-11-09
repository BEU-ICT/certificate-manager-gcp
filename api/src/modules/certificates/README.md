# certificates

Issuing, verifying and revoking certificates. Status: scaffold, the implementation follows in the certificates epic; the interface below is the intended contract.

## Responsibility

Issue certificates (single and bulk), serve the public verification lookup, list and filter for administrators, and revoke (ADR 0010). Owns the certificate state and the public ID rules (`^(?:[A-Za-z0-9_-]{22}|[0-9a-f]{32})$`).

## Public interface

- Service methods: issue, issue bulk, get public, get admin, list, count, revoke.
- Events published: `certificate.issued`, `certificate.revoked` (payloads in `src/ports/event-bus.ts`).
- Events consumed: none.
- Ports used: `CertificateRepository`, `TemplateRepository` (through the `templates` service), `EventBus`, `RateLimiter`, `Clock`, `IdGenerator`.

## Entity and shared rules

- `Certificate` lives in `src/shared/domain.ts` (all spec section 6 fields plus `schemaVersion` and the additive `emailAttempts`, `emailSentAt`, `emailLastError`, `legacy` object, `organizationName`, `eventName`, `updatedAt`, `pdfGeneratedAt`); the closed type registry is `src/shared/certificate-types.ts`.
- `parseCertificateId(value)` (`src/shared/ids.ts`) returns a branded `CertificateId` or throws `NotFoundError`, so malformed IDs answer exactly like unknown ones.
- `schemas.ts` holds the zod field schemas shared by single and bulk issuance (`certificateContentShape(now)` is spread into a `z.strictObject`): text is NFC-normalised, stripped of zero-width/bidi characters, control characters become spaces, whitespace collapsed; e-mail lowercased; skills deduplicated case-insensitively; `issuedAt` at most 5 minutes in the future.
- `domain.ts`: `isRevoked`, `emailInitialStatus`. The public DTO is built in the DTO layer, not here.

## Owned data

Collection `certificates` with indexes `(type, issuedAt desc)`, `(status, issuedAt desc)` and `(emailStatus, issuedAt desc)`. The public lookup costs exactly one document read.

## Non-goals

PDF rendering and storage (see `pdf`) and e-mail delivery (see `notifications`); both react to the events above.

## Revocation (`revocation.ts`)

`RevocationService.revoke(id, reason)` (`POST /api/v1/admin/certificates/:id/revoke`, ADR 0010): `markRevoked` (only `active -> revoked`), then, after the commit, `StorageGateway.delete('pdfs', pdfPath)` (a missing object is success), `clearPdfPath`, and `certificate.revoked` (published only by the call that revoked). Idempotent: repeating the call answers `200`, keeps the original reason (a different one is ignored) and retries a deletion that left `pdfPath` set. A failed deletion yields `200` with `warnings: ["PDF_DELETE_FAILED"]` and an ERROR log with the certificate ID (alert-worthy). No un-revoke exists: re-issue instead.
