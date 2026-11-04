# organizations

Organisations that issue certificates (slug, name). Status: scaffold, the implementation follows in the organisations epic; the interface below is the intended contract.

## Responsibility

Create, read, update and delete organisations and guarantee slug uniqueness. An organisation cannot be deleted while events or certificates still reference it.

## Public interface

- Service methods: create, get, list (cursor pagination), update, delete, count.
- Events published: none.
- Events consumed: none.
- Ports used: `OrganizationRepository`, `Clock`, `IdGenerator`.

## Owned data

Collection `organizations`; slug reservations in `uniques` (`organization-slug:<slug>`). The slug is immutable (`^[a-z0-9]+(-[a-z0-9]+)*$`, 2 to 40 characters).

## Non-goals

Events (see `events`), templates (see `templates`) and administrator accounts (Firebase Auth, ADR 0004).
