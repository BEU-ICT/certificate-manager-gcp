# pdf

Lazy PDF generation and caching (ADR 0007). Status: engine registry and `PdfService` are in place (#99); engines, caching and the HTTP endpoints follow in the PDF epic. The lazy-generation parts below are still the intended contract.

## Responsibility

Render a certificate PDF on first request from its template, store it in the public PDF bucket and serve it from there afterwards. Delete the cached PDF when a certificate is revoked. Enforce the 30 s timeout and the 2 MB size cap.

## Public interface

- Service methods: get or generate PDF for a certificate ID.
- Events published: none.
- Events consumed: `certificate.revoked` (delete the cached PDF, idempotent).
- Ports used: `StorageGateway` (area `pdfs`, and `templates` for reading), `Clock`.

### Engine registry (#99)

- `RenderInput { ownerName, subject, skills, issuedAt, type, publicUrl }` is all an engine sees. There is deliberately no e-mail address: PDFs are public.
- `TemplateRenderer { engine, render(input, assets): Promise<Buffer>, checkFit(input, assets): FitResult }`. `assets` is the templates module's `LoadedTemplate` (`TemplateAssets.load`).
- `RendererRegistry { register(renderer), get(engine) }` (`InMemoryRendererRegistry`). An unknown engine, or a template config without a string `engine`, raises `UnprocessableError('RENDER_ENGINE_UNSUPPORTED')` (HTTP 422, detail path `config.engine`). Registering an engine twice throws.
- `PdfService` (`DefaultPdfService(registry, templateAssets, publicUrl)`): `render(certificate, template)`, `checkFit(certificate, template)` and `preview(templateRef, sample)`. It loads the package via `TemplateAssets`, looks the engine up from `config.engine` and delegates; there are no engine branches. `publicUrl` is a function building the verification URL of a certificate.
- Adding an engine: implement `TemplateRenderer` and add one `registry.register(...)` line in the composition root. No other file changes. The composition root does not construct `PdfService` yet because no engine and no public URL format exist; the first engine task wires it in `src/services.ts`.

## Owned data

Objects in the public PDF bucket with deterministic names derived from the certificate ID. No collection.

## Non-goals

Template storage and validation (see `templates`) and certificate state (see `certificates`).
