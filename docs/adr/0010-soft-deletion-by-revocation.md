# 0010 Soft deletion by `status=revoked`

Status: accepted · Spec §2 · Issue BEU-ICT/certificate-manager#236 §4

## Context

Issued certificates may already have been shared; the public verification link must keep answering truthfully after an issuing error or a withdrawal.

## Decision

Certificates are never hard-deleted by the API. Revocation sets `status=revoked` with a `revokeReason` (1 to 500 characters), publishes the `certificate.revoked` event and removes the cached PDF (ADR 0007). The PDF of a revoked certificate returns 410 `GONE`. Organisations and events that are still referenced cannot be deleted (409 `CONFLICT`).

## Consequences

- The history is kept and verification stays honest.
- Personal data is not erased by revocation; erasure is an operator procedure, not an API feature.
- Lists and counts need the `status` filter and its index.
