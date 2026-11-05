# templates

Immutable certificate template versions (ADR 0008). Status: the config schema (#85) is implemented; the service, repository and package validator follow (#86 and the templates epic). The service interface below is the intended contract.

## Responsibility

Upload, validate and look up template versions per organisation, event and certificate type. A version never changes once created; a new design is a new version. Resolves a template reference for issuing and rendering.

## Public interface

- Service methods: create version (upload and validate files and config), get by reference, list versions, preview.
- Config schema (`index.ts`, implemented): `parseTemplateConfig(input, { files? })` returns `{ ok, config, warnings }` or `{ ok: false, errors, warnings }` with `ConfigIssue = { code, path, message }`; `assertTemplateConfig` throws `UnprocessableError('TEMPLATE_INVALID', ..., details)` (422) instead. `templateConfigSchema` (zod) and the stored `TemplateConfig` type, `templateConfigJsonSchema()` (generates `docs/template-config.schema.json`), `KNOWN_FORMATS` / `FORMAT_NAMES` (formatter names, reused by the formatter registry #102) and `isSafePackagePath`.
- Events published: none.
- Events consumed: none.
- Ports used: `TemplateRepository`, `StorageGateway` (area `templates`), `Clock`.

## Owned data

Collection `templates` (index `organizationId, eventId, type, version desc`) and the objects in the private templates bucket. Reference format `^[a-z0-9]+(-[a-z0-9]+)*-v(0|[1-9][0-9]*)$`, never parsed.

## Non-goals

Rendering PDFs (see `pdf`) and issuing certificates (see `certificates`).

## Template config (`config.json`)

Units are PDF points, origin top-left, y grows downwards. The schema is strict (unknown keys rejected at every level) and described for authors in `docs/template-config.schema.json`; regenerate it with `npm run template-schema:generate -w api` (`template-schema:check` and a unit test fail when it is stale). Defaults are applied in the parsed `TemplateConfig` (the value stored in the Firestore `config` map): `locale` `az`, `lineHeight` 1.2, `minSize` max(6, floor(size x 0.6)) capped at `size`, `format` `text` (`list-comma` for `skills`, `date-long` for `issuedAt`).

Issue paths use the API detail style (`fields.subject.font`, `images[0].file`, `fonts.main`). Cross-field rules and where they are reported:

| Rule                                                                                                                  | Path                                           |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `ownerName` and `qr` required                                                                                         | `fields.ownerName`, `qr`                       |
| `font` is a key of `fonts`                                                                                            | `fields.<name>.font`                           |
| `format` fits the field (`list-comma` only for `skills`, `date-*` only for `issuedAt`)                                | `fields.<name>.format`                         |
| Box right edge inside the page                                                                                        | `fields.<name>.width`, `qr.size`               |
| Box bottom edge inside the page (height = `maxLines x size x lineHeight`)                                             | `fields.<name>.y`, `qr.size`                   |
| No overlap above 2 pt in both axes, QR code included; `allowOverlap: true` on either field downgrades it to a warning | the later box (`fields.<name>` or `qr`)        |
| Referenced files exist in the package (only when `files` is passed)                                                   | `background`, `images[i].file`, `fonts.<name>` |

Package paths are relative, normalised, ASCII `[A-Za-z0-9._/-]`, at most 100 characters; backgrounds end in `.svg`, images are `assets/<name>.png|jpg|jpeg`, fonts `fonts/<file>.ttf`.
