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

`FitChecker` is the narrow `checkFit(certificate, template)` slice of `PdfService`; issuance never renders and never touches Cloud Storage. **Wiring:** `buildServices` builds `Services.issuance` and the route is registered only when `options.fitChecker` is passed. The composition root (`compose.ts`) passes a lazily-resolving `fitChecker` that delegates to `Services.pdf.checkFit` (the real `PdfService`), so the endpoint is served in every composed app; `buildServices` called without a `fitChecker` (unit tests) does not register it.

The route uses `withIdempotency` (optional `Idempotency-Key`): the stored/replayed body is only `{ certificateId }`; the admin DTO (with e-mail address) is built in a `preSerialization` hook, from the just-created certificate or, for a replay, by reading it back. Audit line `certificate.issued` carries id, organizationId, eventId and adminUid only. `publicUrl` is `PUBLIC_BASE_URL/c/<id>`.

## Bulk issuance (`issuance.ts`, BEU-ICT/certificate-manager#340)

`CertificateIssuanceService.issueMany(input, adminUid)` backs `POST /api/v1/admin/certificates/bulk` (1 to 500 items, `FEATURE_BULK_ISSUANCE`: flag off answers 404; body limit 1 MB, handler timeout 55 s; counts as one request for rate limiting). It shares the reference checks (`resolveReferences`, `resolveTemplate`) and the certificate builder with `issue`, so single behaviour is unchanged. The template is resolved **once** and reused for every `checkFit`; there are no per-item Firestore reads.

- The HTTP body schema validates only the envelope `{ organizationId, eventId, type, templateId?, subject?, items }` (strict; `items` empty or above 500 is `400 VALIDATION_FAILED`). Each item is validated by the service with `bulkItemSchema` (strict, same normalisation as single issuance; `subject` optional, overrides the common `subject`; an item without any subject is a problem).
- **All-or-nothing:** every item is validated and fit-checked first; any problem yields `422 BULK_INVALID` with `details: [{ path: "items[17].ownerName", message, code }]` (fit problems map to `items[i].<field>`), at most 200 details, and `error.truncated: true` (present only then) when more exist. Nothing is written. Reference errors (`EVENT_ORG_MISMATCH`, `TEMPLATE_MISMATCH`, `TEMPLATE_NOT_FOUND`) fail the whole request as in single issuance.
- Otherwise one atomic `CertificateRepository.createMany` (a one-time retry with fresh IDs on an ID collision), then one `certificate.issued` event per certificate, sequentially in request order. Duplicates of the same person are allowed.
- Response `201 { created, items: [{ id, ownerName, hasEmail }] }` in request order; no e-mail addresses. `withIdempotency` stores only the ordered certificate IDs; a replay rebuilds `items` with `CertificateRepository.getMany` (chunked batch reads, at most 500 IDs) through `CertificateQueryService.getMany`.
- Audit: one line `certificate.bulk_issued` with `count`, `organizationId`, `eventId`, `template`, `adminUid` (no names or e-mail addresses).
- `npm run bench:bulk -w @certificate-manager/api` times 500 items on in-memory fakes with a no-op fit check. The 10 s target on the 512 MiB / 1 vCPU container (real `PdfService` fit check, Firestore) is **not** measured by it and still has to be recorded in `docs/performance.md`.

## Admin e-mail resend and `emailStatus` filter (BEU-ICT/certificate-manager#377)

- `CertificateRepository.prepareEmailResend` / `CertificateService.prepareEmailResend`: transactional state change for the admin resend (see the notifications README). Pending e-mails older than `EMAIL_STUCK_AFTER_MS` (2 h, by `updatedAt`) count as stuck.
- `GET /api/v1/admin/certificates` and `/count` accept `emailStatus=pending|sent|failed|skipped`; the filter, the `(emailStatus, issuedAt desc)` composite index (`infra/firestore.indexes.json`) and the 63-combination verification were already in place, #377 added the tests only.
