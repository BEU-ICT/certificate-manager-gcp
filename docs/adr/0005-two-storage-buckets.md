# 0005 Two buckets: private templates, public PDFs

Status: accepted · Spec §2 · Issue BEU-ICT/certificate-manager#236 §6

## Context

Template files are internal assets and must not be readable by the public. Generated PDFs are meant to be downloaded by anyone who knows the certificate ID.

## Decision

Cloud Storage holds two buckets, configured as `TEMPLATES_BUCKET` and `PDF_BUCKET`. The templates bucket is private and read only by the service account of the API. The PDF bucket serves public objects under `PDF_PUBLIC_BASE_URL`; object names derive from the unguessable certificate ID. Code reaches both through the `StorageGateway` port (logical areas `templates` and `pdfs`), never through the Cloud Storage SDK directly.

## Consequences

- Public PDFs need no signed URLs and are cacheable.
- Access control is per bucket, so least privilege is simple to express in IAM.
- Revoked certificates must have their PDF deleted (ADR 0007), since public objects cannot be hidden individually.
