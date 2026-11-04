# pdf

Lazy PDF generation and caching (ADR 0007). Status: scaffold, the implementation follows in the PDF epic; the interface below is the intended contract.

## Responsibility

Render a certificate PDF on first request from its template, store it in the public PDF bucket and serve it from there afterwards. Delete the cached PDF when a certificate is revoked. Enforce the 30 s timeout and the 2 MB size cap.

## Public interface

- Service methods: get or generate PDF for a certificate ID.
- Events published: none.
- Events consumed: `certificate.revoked` (delete the cached PDF, idempotent).
- Ports used: `StorageGateway` (area `pdfs`, and `templates` for reading), `Clock`.

## Owned data

Objects in the public PDF bucket with deterministic names derived from the certificate ID. No collection.

## Non-goals

Template storage and validation (see `templates`) and certificate state (see `certificates`).
