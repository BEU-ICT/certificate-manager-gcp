# 0012 Hexagonal boundaries and how they are enforced

Status: accepted · Spec §5, §5.1, §5.2 · Builds on ADR 0001

## Context

ADR 0001 defines the ports and adapters. Without automation the rules decay, so spec §5.2 asks that they be verified in the build.

## Decision

The boundaries are checked in CI, not by review alone:

- ESLint (`api/eslint.boundaries.js`) rejects vendor SDK imports outside `src/adapters/**`, imports of `src/testing/**` from production code and `DocumentReference` outside adapters.
- dependency-cruiser (`api/.dependency-cruiser.cjs`) enforces the layering, forbids a module from importing another module except through its `index.ts`, forbids modules and ports from importing adapters or `http`, and forbids cycles.
- `api/scripts/check-document-reference.mjs` greps for `DocumentReference`, comments included.
- Negative tests in `api/test/architecture` prove each rule fails on a violating fixture.
- Every directory under `api/src/modules/*` must contain a non-empty `README.md` stating its responsibility and public interface (`api/scripts/check-module-readmes.mjs`, spec §5.2 rule 6).

## Consequences

- A violation fails the PR; a new vendor SDK must be added to `VENDOR_PACKAGES`.
- New modules need a README from the first commit.
- A change to a rule needs its negative test updated.
