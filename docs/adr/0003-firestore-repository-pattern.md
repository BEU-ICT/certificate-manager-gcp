# 0003 Firestore with the repository pattern

Status: accepted · Spec §2, §5 · Issue BEU-ICT/certificate-manager#236 §5

## Context

Firestore (Native mode, `(default)` database) fits the document-shaped data and the free tier, but reads are the scarce resource (50k/day) and a return to PostgreSQL is planned as a possible later adapter.

## Decision

Entities are persisted through the repository ports in `api/src/ports/repositories.ts` (`OrganizationRepository`, `EventRepository`, `TemplateRepository`, `CertificateRepository`). Only `api/src/adapters/firestore/**` may touch the Firestore SDK; relations are plain string IDs, never `DocumentReference`. Where uniqueness cannot be enforced natively, adapters write a reservation document in the `uniques` collection in the same transaction. Lists use opaque cursors, totals use separate `count()` queries, and the public certificate lookup costs exactly one document read.

## Consequences

- Domain code and tests run on in-memory fakes; each adapter must pass the shared port contract tests.
- Extra composite indexes are required (listed in issue BEU-ICT/certificate-manager#236 §5) and live in `infra/`.
- Queries are limited to what Firestore indexes support; the port interface is designed around that.
