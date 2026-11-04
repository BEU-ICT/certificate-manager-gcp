# organizations

Organisations that issue certificates (slug, name). Status: domain, repository and service implemented; the admin API follows (#77).

## Responsibility

Create, read, update and delete organisations and guarantee slug uniqueness. An organisation cannot be deleted while events or certificates still reference it.

## Public interface

- `OrganizationService` (`index.ts`): `create({ name, slug? })`, `get`, `list` (cursor pagination, ordered by name), `rename` (name only), `delete`, `exists`, `getSnapshotName`, `getNames` (batched).
- `ReferenceCheckRegistry` / `ReferenceChecker { name, countReferences(organizationId) }`: modules that reference organizations (events, templates, certificates) register a checker in `src/services.ts`; `delete` fails with `InUseError` (409, `counts` per checker) while any count is above zero. The module never reads other modules' collections.
- Errors: `SlugTakenError` (409, `details[0].suggestion` holds the next free slug, the server never appends a suffix silently), `InUseError`, `NotFoundError` (also for malformed ids), `ValidationError` (names 1 to 120 characters, no control characters; slug rules below).
- Events published: none. Events consumed: none.
- Ports used: `OrganizationRepository`, `Clock`, `IdGenerator`.

## Owned data

Collection `organizations` (`name`, `slug`, `createdAt`, `updatedAt`, `schemaVersion`); slug reservations in `uniques` (`organization-slug:<slug>`). The slug is immutable (`^[a-z0-9]+(-[a-z0-9]+)*$`, 2 to 40 characters).

## Non-goals

Events (see `events`), templates (see `templates`) and administrator accounts (Firebase Auth, ADR 0004).
