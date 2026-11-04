# templates

Immutable certificate template versions (ADR 0008). Status: scaffold, the implementation follows in the templates epic; the interface below is the intended contract.

## Responsibility

Upload, validate and look up template versions per organisation, event and certificate type. A version never changes once created; a new design is a new version. Resolves a template reference for issuing and rendering.

## Public interface

- Service methods: create version (upload and validate files and config), get by reference, list versions, preview.
- Events published: none.
- Events consumed: none.
- Ports used: `TemplateRepository`, `StorageGateway` (area `templates`), `Clock`.

## Owned data

Collection `templates` (index `organizationId, eventId, type, version desc`) and the objects in the private templates bucket. Reference format `^[a-z0-9]+(-[a-z0-9]+)*-v(0|[1-9][0-9]*)$`, never parsed.

## Non-goals

Rendering PDFs (see `pdf`) and issuing certificates (see `certificates`).
