# 0008 Immutable template versions and reference scheme

Status: accepted · Spec §2, §6 · Issue #16 §5

## Context

A certificate must keep looking the way it did when it was issued, even after the design changes.

## Decision

A template version is immutable once created; changing a design creates a new version with the next number. Certificates store the template reference. The reference matches `^[a-z0-9]+(-[a-z0-9]+)*-v(0|[1-9][0-9]*)$` and is never parsed: organisation, event, type and version are stored as separate fields. Certificate types are a closed registry in one code file (`certificate-types.ts`); each type is a single lowercase token without hyphens.

## Consequences

- Reproducible PDFs and an audit trail of designs; storage grows with each version.
- Adding a type is a code and i18n change, not data.
- Issuing against a missing or mismatching template fails with 422 (`TEMPLATE_NOT_FOUND`, `TEMPLATE_MISMATCH`).
