# 0013 Corrections to the spec

Status: accepted · Spec §2, §6 · Issue BEU-ICT/certificate-manager#236 (items marked "spec delta")

## Context

While planning the implementation, points of the spec turned out to be wrong or incomplete. Issue BEU-ICT/certificate-manager#236 is the source of truth; this record keeps the main ones next to the other decisions.

## Decision

- **Migration marker path.** The spec path `system/migrations/bootstrap-admin` is not a valid Firestore document path. One document `system/migrations` holds a map `applied.<migrationId> = { at, by }`; the bootstrap administrator uses key `001-bootstrap-admin`.
- **PDF race resolution.** The spec's handling of concurrent first requests for the same certificate is replaced by the resolution specified in the `pdf` module task; this record only notes that a correction exists. See the module README once the module is implemented.
- **IAM role additions.** The implemented flows need service-account roles beyond those listed in the spec. The authoritative list is kept in `infra/` and the infrastructure tasks.
- **MySQL legacy source.** The legacy data source is MySQL, not PostgreSQL; the migration (epic BEU-ICT/certificate-manager#402) reads MySQL and also converts the legacy templates. Legacy certificate IDs are 32-character lowercase hex (MD5) and are accepted unchanged next to the 22-character base64url IDs.

## Consequences

- Implementers follow issue BEU-ICT/certificate-manager#236 where it differs from the spec.
- If the spec is revised, this ADR and issue BEU-ICT/certificate-manager#236 are updated together.
