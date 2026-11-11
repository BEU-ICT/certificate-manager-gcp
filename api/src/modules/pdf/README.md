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
- Extension points: `new SvgPdfRenderer({ fieldsLayer, qrLayer })`. A `DrawLayer` receives `DrawContext` (document, input, package, parsed config, page size, `fontName(key)`) and runs after the images in the order fields, QR. Text fitting (`checkFit`) and the QR code arrive with BEU-ICT/certificate-manager#320 and #323; until then `checkFit` reports that everything fits.
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
