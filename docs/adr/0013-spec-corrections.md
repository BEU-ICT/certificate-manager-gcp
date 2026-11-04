# 0013 Corrections to the spec

Status: accepted · Spec §2, §6 · Issue #16 (items marked "spec delta")

## Context

While planning the implementation, points of the spec turned out to be wrong or incomplete. Issue #16 is the source of truth; this record keeps the main ones next to the other decisions.

## Decision

- **Migration marker path.** The spec path `system/migrations/bootstrap-admin` is not a valid Firestore document path. One document `system/migrations` holds a map `applied.<migrationId> = { at, by }`; the bootstrap administrator uses key `001-bootstrap-admin`.
- **PDF race resolution.** Concurrent first requests for the same certificate must not produce two different objects. The PDF object name is deterministic per certificate and the write must not overwrite an existing object, so the loser of the race serves the stored PDF. The exact mechanics are specified in the `pdf` task and module README.
- **IAM role additions.** The service accounts receive the extra roles the implemented flows need beyond the spec (for example creating Cloud Tasks tasks and acting as the task invoker), each at least privilege. The authoritative list is kept in `infra/` and issue #16.
- **MySQL legacy source.** The legacy data source is MySQL, not PostgreSQL; the migration (epic #183) reads MySQL and also converts the legacy templates. Legacy certificate IDs are 32-character lowercase hex (MD5) and are accepted unchanged next to the 22-character base64url IDs.

## Consequences

- Implementers follow issue #16 where it differs from the spec.
- If the spec is revised, this ADR and issue #16 are updated together.
