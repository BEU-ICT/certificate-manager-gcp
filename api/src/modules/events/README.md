# events

Events (conferences, courses) of an organisation. Status: domain, repository and service implemented; the admin API follows (BEU-ICT/certificate-manager#300).

## Responsibility

Create, read, update and delete events within an organisation, including the e-mail language of the event (`emailLanguage`: `az` default, or `en`). An event cannot be deleted while certificates reference it.

## Public interface

- `EventService` (`index.ts`): `create({ organizationId, name, slug?, emailLanguage? })` (verifies the organization through `OrganizationService.exists`; 404 with `details.path = organizationId` otherwise), `get`, `list({ organizationId? }, page)` (newest first, cursor pagination), `update({ name?, emailLanguage? })` (slug and organization are immutable), `delete`, `exists`, `getSnapshot(id)` (`{ id, name, organizationId }` for certificate issuance), `countByOrganization`.
- Slugs are unique within the organization; `SlugTakenError` carries a `suggestion`. `delete` fails with `InUseError` (409, counts per checker) while checkers registered on `eventReferences` (templates, certificates; see `src/services.ts`) report references.
- The module registers the `events` reference checker on the organizations registry (composition root), so organizations with events cannot be deleted.
- Events published: none. Events consumed: none.
- Ports used: `EventRepository`, `Clock`, `IdGenerator`; `OrganizationService` (public interface of `organizations`).

## Owned data

Collection `events`; slug reservations in `uniques` (`event-slug:<orgId>:<slug>`).

## Non-goals

Organisations (see `organizations`), certificates issued for an event (see `certificates`) and sending mail (see `notifications`).
