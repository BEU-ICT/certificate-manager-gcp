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

## Admin read side (`query-service.ts`)

`CertificateQueryService` (`Services.certificateQueries`) offers `list(filter, page)`, `count(filter)` and `get(id)` over `CertificateRepository`; `get` uses `parseCertificateId`, so malformed and unknown IDs both raise `NotFoundError`. The HTTP layer (`src/http/routes/admin-certificates.ts`, DTOs in `src/http/dto/admin/certificate.ts`) serves `GET /api/v1/admin/certificates` (summaries, no e-mail address, `hasEmail` only), `/count` and `/{id}` (full DTO with `email`, `publicUrl` = `PUBLIC_BASE_URL/c/<id>`, `pdfUrl` = `PDF_PUBLIC_BASE_URL/<pdfPath>` or null; `pdfPath` itself is never returned). Date filters: `YYYY-MM-DD` covers the whole UTC day (`issuedTo` inclusive); an ISO date-time is inclusive for `issuedFrom` and exclusive for `issuedTo`; at most 5 years.

## Owned data

Collection `certificates` with indexes `(type, issuedAt desc)`, `(status, issuedAt desc)` and `(emailStatus, issuedAt desc)`. The public lookup costs exactly one document read.

## Non-goals

PDF rendering and storage (see `pdf`) and e-mail delivery (see `notifications`); both react to the events above.

## Revocation (`revocation.ts`)

`RevocationService.revoke(id, reason)` (`POST /api/v1/admin/certificates/:id/revoke`, ADR 0010): `markRevoked` (only `active -> revoked`), then, after the commit, `StorageGateway.delete('pdfs', pdfPath)` (a missing object is success), `clearPdfPath`, and `certificate.revoked` (published only by the call that revoked). Idempotent: repeating the call answers `200`, keeps the original reason (a different one is ignored) and retries a deletion that left `pdfPath` set. A failed deletion yields `200` with `warnings: ["PDF_DELETE_FAILED"]` and an ERROR log with the certificate ID (alert-worthy). No un-revoke exists: re-issue instead.

## Single issuance (`issuance.ts`)

`CertificateIssuanceService.issue(input, adminUid)` (`Services.issuance`) backs `POST /api/v1/admin/certificates`: resolves the organization and event (`EventService.getSnapshot` must belong to the organization, else 422 `EVENT_ORG_MISMATCH`), then the template (explicit `templateId` must exist and match organization, event and type, else 422 `TEMPLATE_MISMATCH` with the mismatching fields as details; absent means latest version, none at all gives 422 `TEMPLATE_NOT_FOUND`), runs `FitChecker.checkFit` (422 `TEXT_DOES_NOT_FIT` listing every failing field, nothing stored), creates the document (`status: active`, `emailStatus` `pending`/`skipped`, name snapshots, `createdBy` = admin uid) and publishes `certificate.issued` (awaited; subscriber errors never fail the request). A `ConflictError` on create (ID collision) is retried once with a fresh ID. Reads: org, event, template (plus latest lookup) and one write.

`FitChecker` is the narrow `checkFit(certificate, template)` slice of `PdfService`; issuance never renders and never touches Cloud Storage. **Wiring:** `buildServices` builds `Services.issuance` and the route is registered only when `options.fitChecker` is passed. The composition root (`compose.ts`) must pass `fitChecker: pdfService` once the PDF service is wired (BEU-ICT/certificate-manager#325); until then the endpoint is not served.

The route uses `withIdempotency` (optional `Idempotency-Key`): the stored/replayed body is only `{ certificateId }`; the admin DTO (with e-mail address) is built in a `preSerialization` hook, from the just-created certificate or, for a replay, by reading it back. Audit line `certificate.issued` carries id, organizationId, eventId and adminUid only. `publicUrl` is `PUBLIC_BASE_URL/c/<id>`.
