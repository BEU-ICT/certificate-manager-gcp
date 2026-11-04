# events

Events (conferences, courses) of an organisation. Status: scaffold, the implementation follows in the events epic; the interface below is the intended contract.

## Responsibility

Create, read, update and delete events within an organisation, including the e-mail language of the event (`emailLanguage`: `az` default, or `en`). An event cannot be deleted while certificates reference it.

## Public interface

- Service methods: create, get, list (cursor pagination), update, delete, count.
- Events published: none.
- Events consumed: none.
- Ports used: `EventRepository`, `OrganizationRepository` (existence check), `Clock`, `IdGenerator`.

## Owned data

Collection `events`; slug reservations in `uniques` (`event-slug:<orgId>:<slug>`).

## Non-goals

Organisations (see `organizations`), certificates issued for an event (see `certificates`) and sending mail (see `notifications`).
