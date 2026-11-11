# pdf

Lazy PDF generation and caching (ADR 0007). Status: engine registry and `PdfService` are in place (BEU-ICT/certificate-manager#318); engines, caching and the HTTP endpoints follow in the PDF epic. The lazy-generation parts below are still the intended contract.

## Responsibility

Render a certificate PDF on first request from its template, store it in the public PDF bucket and serve it from there afterwards. Delete the cached PDF when a certificate is revoked. Enforce the 30 s timeout and the 2 MB size cap.

## Public interface

- Service methods: get or generate PDF for a certificate ID.
- Events published: none.
- Events consumed: `certificate.revoked` (delete the cached PDF, idempotent).
- Ports used: `StorageGateway` (area `pdfs`, and `templates` for reading), `Clock`.

### Engine registry (BEU-ICT/certificate-manager#318)

- `RenderInput { ownerName, subject, skills, issuedAt, type, publicUrl }` is all an engine sees. There is deliberately no e-mail address: PDFs are public.
- `TemplateRenderer { engine, render(input, assets): Promise<Buffer>, checkFit(input, assets): FitResult }`. `assets` is the templates module's `LoadedTemplate` (`TemplateAssets.load`).
- `RendererRegistry { register(renderer), get(engine) }` (`InMemoryRendererRegistry`). An unknown engine, or a template config without a string `engine`, raises `UnprocessableError('RENDER_ENGINE_UNSUPPORTED')` (HTTP 422, detail path `config.engine`). Registering an engine twice throws.
- `PdfService` (`DefaultPdfService(registry, templateAssets, publicUrl)`): `render(certificate, template)`, `checkFit(certificate, template)` and `preview(templateRef, sample)`. It loads the package via `TemplateAssets`, looks the engine up from `config.engine` and delegates; there are no engine branches. `publicUrl` is a function building the verification URL of a certificate.
- Adding an engine: implement `TemplateRenderer` and add one `registry.register(...)` line in the composition root. No other file changes. The composition root does not construct `PdfService` yet because no engine and no public URL format exist; the first engine task wires it in `src/services.ts`.

### `svg-pdf` engine (BEU-ICT/certificate-manager#319)

- `SvgPdfRenderer` (`engines/svg-pdf/`, engine name `svg-pdf`) builds a PDFKit document (`autoFirstPage: false`, compressed, page size and orientation from `config.page`), registers the template fonts from the package buffers (subset-embedded by PDFKit), draws `background.svg` stretched over the page with svg-to-pdfkit (vector, `preserveAspectRatio="none"`, only `data:` images are embedded), then `config.images` in order, then the optional layers.
- Metadata: `Title` "Certificate", `Author` = `RenderInput.organizationName` (omitted for previews), `Producer`/`Creator` "Certificate Management System", `CreationDate` = `issuedAt`. PDFKit derives the trailer `ID` from the info dictionary, so the same input renders byte-identical files; the clock is never read.
- Extension points: `new SvgPdfRenderer({ fieldsLayer, qrLayer })`. A `DrawLayer` receives `DrawContext` (document, input, package, parsed config, page size, `fontName(key)`) and runs after the images in the order fields, QR. Text fitting is plugged in with `createFields()` (below); the QR code arrives with BEU-ICT/certificate-manager#323. Without a `fitChecker` option `checkFit` reports that everything fits.
- Fallback font: an SVG text whose `font-family` matches no template font uses the first template font, or PDFKit's built-in Helvetica when the package has none. Helvetica is read by PDFKit from its bundled `.afm` file (a read-only file inside `node_modules`, the only file access during a render). If the document build throws, the PDFKit document is destroyed before the error propagates.
- Not registered in the composition root yet (see "Adding an engine"): that happens together with the fields layer.
- Formatters (`FormatterRegistry`, `createFormatterRegistry`) are exported from the module index for the fields layer.

### QR code layer (BEU-ICT/certificate-manager#323)

- `engines/svg-pdf/qr.ts`: `drawQr` is the `qrLayer` (`new SvgPdfRenderer({ qrLayer: drawQr })`); `checkQrFit(input, config)` returns the layout `FitIssue[]` for the QR code.
- Encodes `RenderInput.publicUrl` (`https://{domain}/c/{id}`) with `qrcode` at error correction M, automatic version (22-char and legacy 32-hex IDs stay at version <= 5).
- Draws a white `qr.size` square at `qr.x, qr.y` with the black modules inside it; the 4-module quiet zone is part of `size`. Horizontal runs are merged; all rectangles form one path filled once, with edges snapped to a 0.01 pt grid so neighbours share identical coordinates (no seams).
- Modules below 0.4 mm (about 1.13 pt) raise `UnprocessableError('QR_TOO_SMALL')` (detail path `config.qr.size`) in `render`; `checkQrFit` reports the same as a `FitIssue` (`field: 'qr'`, message starting with `QR_TOO_SMALL`) so `checkFit` can merge it.

## Owned data

Objects in the public PDF bucket with deterministic names derived from the certificate ID. No collection.

## Non-goals

Template storage and validation (see `templates`) and certificate state (see `certificates`).

### Field layout, shrink-to-fit and `checkFit` (BEU-ICT/certificate-manager#320)

- `createFields({ formatters? })` (`engines/svg-pdf/fields.ts`) returns `{ fieldsLayer, checkFit }`; wire both: `new SvgPdfRenderer({ fieldsLayer, fitChecker: checkFit })`. Each configured field is formatted by the formatter registry (`format`, `locale`), then laid out by `layoutField(text, fieldConfig, font)` (`layout.ts`). Empty or blank values are skipped (no line, no error).
- `layoutField` normalises whitespace (newlines become spaces), wraps greedily at spaces using the embedded font's metrics (fontkit advance widths, parsed once per package buffer), and starts at `size`. While the text needs more than `maxLines` lines it shrinks by 0.5 pt down to `minSize`. A word wider than the box is split by character only at `minSize`. Lines are top-aligned: the first baseline is `y` plus the font ascent, following lines add `size * lineHeight`; `align` offsets each line inside the box.
- `render` (the fields layer) and `checkFit` call the same `layoutAll`/`layoutField` code, so line breaks are identical. A field that still does not fit at `minSize` is drawn at `minSize` by `render` (rejection is the issuance caller's job) and reported by `checkFit`.
- `checkFit` loads fonts only (no PDF or stream is created) and returns all misfits at once as `FitIssue { field, message, reason: 'TEXT_DOES_NOT_FIT', requiredLines, maxLines, minSize }`; issuance maps them to `422 TEXT_DOES_NOT_FIT` with `details[{ path: field, message }]`. Text is only measured and drawn, never parsed as markup.

### Composition and admin preview (BEU-ICT/certificate-manager#325)

- `buildServices` (`src/services.ts`) now constructs `Services.pdf`: `createFormatterRegistry()`, an `InMemoryRendererRegistry` with `new SvgPdfRenderer({ fieldsLayer, qrLayer: drawQr, fitChecker })` (from `createFields`), and `DefaultPdfService(registry, templateAssets, certificate => <PUBLIC_BASE_URL>/c/<id>)`. `PUBLIC_BASE_URL` arrives through `ServiceOptions.publicBaseUrl` (compose.ts).
- `checkFit` of the fields plugin also returns the QR verdict (`checkQrFit`, `field: 'qr'`, `reason: 'QR_TOO_SMALL'`), so `SvgPdfRenderer.checkFit` reports text misfits and a too-small QR code together.
- `PdfService.preview(ref, sample)` runs load assets (one cached load), `checkFit`, then `render`. A misfit raises `assertFits` -> `UnprocessableError('TEXT_DOES_NOT_FIT')` (`QR_TOO_SMALL` when only the QR code is wrong) with `details[{ path: field, message }]`; nothing is rendered or stored.
- HTTP: `POST /api/v1/admin/templates/{reference}/preview` (`http/routes/admin-templates.ts`, body `http/dto/admin/template-preview.ts`). Body optional, strict: `ownerName`, `subject`, `skills`, `issuedAt` (certificate limits), `preset` `typical` (default) or `longest` (120-char name, 200-char subject, 10 skills x 40 chars); provided fields override the preset. The QR code encodes `<PUBLIC_BASE_URL>/c/PREVIEW000000000000000`. Response `200 application/pdf`, `Content-Disposition: inline; filename="preview-<reference>.pdf"`, `Cache-Control: no-store`. Unknown template 404. No data of real certificates is used.

### Render guard (BEU-ICT/certificate-manager#328)

- `RenderLimiter` (`limiter.ts`, exported for the composition root): semaphore of `PDF_MAX_CONCURRENT_RENDERS` (default 3). Waiting requests queue for up to 10 s, then `UnavailableError` (503, `Retry-After: 5`). Each render gets an `AbortSignal` that fires after `PDF_RENDER_TIMEOUT_MS` (default 30000): the request fails with `UnavailableError` (503, `Retry-After: 5`, "PDF rendering timed out") and the permit is freed even if the engine ignores the signal. A permit is also released on failure. `TemplateRenderer.render` receives the signal as optional third argument `{ signal }`; `SvgPdfRenderer` calls `signal.throwIfAborted()` before the fonts and after each stage (background, images, fields, QR), and the service re-checks it before the size check.
- `DefaultPdfService(registry, assets, publicUrl, { limiter?, logger?, maxPdfBytes? })` guards `render` and `preview` (including the template load); `checkFit` is cheap and not guarded. Without `limiter` it builds one from the defaults; `config.pdf` carries the parsed env values for the composition root to pass in.
- PDFs over 2 MB fail with 422 `RENDER_TOO_LARGE` and an ERROR log naming the template reference. Each success logs `pdf_rendered { reference, durationMs, bytes, queuedMs }`; `durationMs` includes the template asset load but not the queue wait.
- Benchmark and budgets: `docs/performance.md` (`npm run bench:render -w @certificate-manager/api`).

### Public on-demand PDF (BEU-ICT/certificate-manager#359)

- `GET /api/v1/public/certificates/{id}/pdf` (`http/routes/public-certificate-pdf.ts`, operation `getPublicCertificatePdf`) delegates to `PublicPdfService.ensurePdf` (`public-pdf-service.ts`, built in `services.ts` as `Services.publicPdf`; ports only: certificates, `TemplateService.get`, `PdfService.render`, `StorageGateway`, `IdGenerator`, `Clock`). Success is `302` to `<PDF_PUBLIC_BASE_URL>/pdfs/<token>.pdf` with `Cache-Control: no-store`.
- Order: malformed or unknown ID 404 (identical) -> revoked 410 -> `pdfPath` set: redirect (no render, kill switch ignored) -> `FEATURE_PUBLIC_PDF_GENERATION` off: 503 -> single-flight per certificate ID in the instance -> load template, render under the limiter -> `putIfAbsent('pdfs', '<token>.pdf')` (`application/pdf`, `Cache-Control: no-cache`, `Content-Disposition: inline; filename="certificate-<id>.pdf"`) -> `setPdfPathIfAbsent`.
- Spec delta: the object name is a random token, so the storage precondition cannot arbitrate; the transactional `setPdfPathIfAbsent` is the arbiter. A loser (`winner: false`) deletes its own surplus object and redirects to the winner's path; a certificate revoked meanwhile gives 410 and the object is deleted. Delete failures are logged (WARN, no path) and never thrown.
- Failures: storage failure or database failure after upload gives 503 `Retry-After: 5` (the object is deleted best-effort, no `pdfPath` written); render capacity/timeout errors stay 503; a missing template or asset, a failed fit or any other render error gives 500 `INTERNAL` and an ERROR log with `certId` and `templateRef` (alert-worthy: templates are immutable). No personal data is logged.
- Logs `pdf_generated { certId, templateRef, durationMs, bytes, cache: 'miss' }` once per generation (the winner only).
- Wiring: `buildServices` passes the logger and a `RenderLimiter` built from `config.pdf` (`ServiceOptions.pdf`, set by `compose.ts`) to `DefaultPdfService`.
