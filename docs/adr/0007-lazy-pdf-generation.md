# 0007 Lazy PDF generation with caching and deletion on revocation

Status: accepted · Spec §2 · Issue BEU-ICT/certificate-manager#236 §4, §7, §11

## Context

Most certificates are never downloaded, and rendering a PDF costs CPU, memory and storage. Revoked certificates must stop being downloadable.

## Decision

Issuing a certificate stores only data. The PDF is rendered on first request by the `pdf` module (PDFKit), written to the PDF bucket and served from there afterwards (cache). Generation has a hard internal timeout of 30 s and a size cap of 2 MB; failure maps to 503 `UNAVAILABLE` with `Retry-After`. Concurrent first requests are resolved as recorded in ADR 0013. Revoking a certificate deletes the cached PDF, and later requests return 410 `GONE`.

## Consequences

- Storage and CPU are spent only on certificates somebody opens; the first view is slower (p95 target 5 s).
- Generation must be idempotent and safe to run twice.
- The feature can be switched off with `FEATURE_PUBLIC_PDF_GENERATION`.
