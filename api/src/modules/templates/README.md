# templates

Immutable certificate template versions (ADR 0008). Status: the config schema (#85) and the package validator (#86) are implemented; the service and repository follow in the templates epic. The service interface below is the intended contract.

## Responsibility

Upload, validate and look up template versions per organisation, event and certificate type. A version never changes once created; a new design is a new version. Resolves a template reference for issuing and rendering.

## Public interface

- Service methods: create version (upload and validate files and config), get by reference, list versions, preview.
- Config schema (`index.ts`, implemented): `parseTemplateConfig(input, { files? })` returns `{ ok, config, warnings }` or `{ ok: false, errors, warnings }` with `ConfigIssue = { code, path, message }`; `assertTemplateConfig` throws `UnprocessableError('TEMPLATE_INVALID', ..., details)` (422) instead. `templateConfigSchema` (zod) and the stored `TemplateConfig` type, `templateConfigJsonSchema()` (generates `docs/template-config.schema.json`), `KNOWN_FORMATS` / `FORMAT_NAMES` (formatter names, reused by the formatter registry #102) and `isSafePackagePath`.
- Repository and versioning (#88, `service.ts`, `reference.ts`, `storage-keys.ts`): `TemplateService.nextReference(target)` returns `maxVersion + 1` (0 first) as `<orgSlug>-<eventSlug>-<type>-v<n>`, validated against the reference regex and 120 characters (`buildTemplateReference`, `ValidationError` before anything is written). `publish(input)` stores `config.json` with `putIfAbsent` (the claim on the version), then the other files, then writes the document last; when a concurrent upload took the number it retries with the next one (3 retries, then `ConflictError`). Also `get`, `getLatest`, `list`, `countByEvent`, `countByOrganization` (the last two are registered as the `templates` checker on `eventReferences` and `organizationReferences` in `src/services.ts`, so deleting an event or organization with templates is `IN_USE`).
- Storage keys (`templateConfigKey`, `templateBackgroundKey`, `templateFontKey`, `templateAssetKey`, `templateKey`) are built only from a validated reference and safe file names, in the `templates` bucket (`StorageGateway` bucketKind `templates`). Package files are `background.svg`, `fonts/<name>.ttf`, `assets/<name>.png|jpg|jpeg`; a failed upload deletes what it stored (a claimed `config.json` of an unfinished upload only costs a version number).
- Package validator (`index.ts`, implemented): `validateTemplatePackage(files: ReadonlyMap<string, Buffer>, config: TemplateConfig)` returns `{ errors, warnings }` of `Issue = { code, path, file?, message }`; the upload is rejected when `errors` is not empty. Pure (no I/O, no network); `config` comes from `parseTemplateConfig`. Limits are exported as `PACKAGE_LIMITS`.
- Read API (#92): `GET /api/v1/admin/templates` (filters `organizationId`, `eventId`, `type`; cursor pagination; `isLatest` from one `maxVersion` per (organization, event, type) group on the page) and `GET /api/v1/admin/templates/{reference}` (adds `config`, `files` from a storage `list` plus object sizes, `certificateCount`; unknown and malformed references are 404). `certificateCount` comes from the narrow port `TemplateCertificateCounter` (`certificate-counter.ts`); until the certificates epic (E7) passes its implementation as the second argument of `buildServices`, it is 0.
- Upload check (#89, `upload.ts`): `checkTemplateUpload(configInput, files, intake?)` runs `parseTemplateConfig` with the uploaded file list (missing files), `validateTemplatePackage` and the storage layout (`packageLayoutProblem`), and throws `UnprocessableError` `TEMPLATE_INVALID` whose `details[]` list every finding as `{ code, path, file?, message }`; it returns the parsed config and the warnings. `DefaultTemplateService` logs an ERROR with the reference when `publish` fails after objects were stored (after the cleanup attempt).
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

## Template asset loader

`TemplateAssets.load(reference)` (`assets.ts`, `services.templateAssets`) returns `{ template, background, fonts, images }` for rendering. Objects are read in parallel (at most 6 concurrent storage reads), cached in-process by reference (LRU with a byte budget from `TEMPLATE_CACHE_MB`, default 40; TTL 30 min; packages larger than the budget are returned uncached) and loads of one reference are single-flight. A missing document or object raises `NotFoundError` (logged at ERROR with the reference: immutable packages never lose files); errors are never cached. Each load logs `templateLoadMs`, `bytes` and `cache: hit|miss`. Returned buffers are shared: do not mutate them.

## Package validation (`validateTemplatePackage`)

Uploaded files come from admins but are treated as untrusted. Sizes and counts are checked before anything is parsed. `path` is the config path (`background`, `images[0].file`, `fonts.main`) or the file name for name problems; `file` is the package path.

Limits: at most 30 files, 10 MB in total, `background.svg` 5 MB, images 2 MB and 4000 px per side, fonts 3 MB. SVG parser limits: depth 64, 200,000 elements, 100 attributes per element.

| Code                                                                         | Level   | Meaning                                                                                           |
| ---------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `TOO_MANY_FILES`, `PACKAGE_TOO_LARGE`                                        | error   | package limits (validation stops there)                                                           |
| `FILE_TOO_LARGE`                                                             | error   | per-file limit (background, image, font)                                                          |
| `FILENAME_CONTROL_CHARACTERS`, `FILENAME_INVALID`, `FILENAME_DUPLICATE_CASE` | error   | unsafe name; duplicates differing only by case                                                    |
| `FILE_NOT_FOUND`                                                             | error   | a file referenced by the config is not in the package                                             |
| `UNREFERENCED_FILE`                                                          | warning | file not referenced by `config.json`                                                              |
| `SVG_DOCTYPE`                                                                | error   | `<!DOCTYPE` / `<!ENTITY` (XXE, billion laughs); never expanded                                    |
| `SVG_NOT_XML`, `SVG_TOO_COMPLEX`, `SVG_ROOT_NOT_SVG`                         | error   | malformed XML, depth/node limits, root is not `<svg>`                                             |
| `SVG_SCRIPT`, `SVG_FOREIGN_OBJECT`, `SVG_EVENT_HANDLER`                      | error   | `<script>`, `<foreignObject>`, `on*` attributes                                                   |
| `SVG_EXTERNAL_REFERENCE`, `SVG_CSS_IMPORT`                                   | error   | `href` or `url(...)` other than an in-document `#id` or `data:image/png` or `jpeg`; CSS `@import` |
| `SVG_NO_VIEWBOX`, `SVG_VIEWBOX_MISMATCH`                                     | error   | viewBox missing; aspect ratio more than 3% off the page                                           |
| `SVG_VIEWBOX_ASPECT`                                                         | warning | aspect ratio 1-3% off the page                                                                    |
| `SVG_TEXT_ELEMENTS`                                                          | warning | `<text>` present: fonts are not embedded in SVG, convert text to outlines (#112)                  |
| `IMAGE_CORRUPT`, `IMAGE_TYPE_MISMATCH`, `IMAGE_TOO_LARGE_DIMENSIONS`         | error   | not PNG/JPEG by magic bytes or bad header; extension disagrees with content; over 4000 px         |
| `IMAGE_LOW_RESOLUTION`, `IMAGE_HIGH_RESOLUTION`                              | warning | below 150 DPI or above 600 DPI at the configured printed `width`                                  |
| `FONT_INVALID`                                                               | error   | not a TrueType/OpenType font (checked with `fontkit`), empty, or a collection                     |
| `FONT_MISSING_GLYPHS`                                                        | error   | a font used by `ownerName` or `subject` lacks the Azerbaijani alphabet, digits or `.,-'’()/`      |
| `FONT_NO_CYRILLIC`                                                           | warning | such a font lacks basic Cyrillic                                                                  |

CLI (offline, reads a directory, no symlinks): `npm run template:validate -w api -- <dir> [--json]`; exit code 0 accepted, 1 rejected, 2 usage. Test corpus: `test/fixtures/templates/` (`good/` package and `malicious/` files); `npm run template-fixtures:generate -w api` rebuilds the binary fixtures deterministically from `test/fixtures/templates/build.ts`.
