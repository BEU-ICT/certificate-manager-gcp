# Performance: PDF rendering

Budgets (BEU-ICT/certificate-manager#236 section 7): p95 render time <= 5 s, hard internal timeout 30 s, peak RSS <= 400 MiB, PDF <= 500 KB typical and 2 MB hard cap.

## Render guard (BEU-ICT/certificate-manager#328)

`DefaultPdfService` runs every `render` and `preview` through a `RenderLimiter` (`api/src/modules/pdf/limiter.ts`):

| Setting                      | Default | Behaviour                                                                                                                                           |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PDF_MAX_CONCURRENT_RENDERS` | 3       | Renders beyond this queue.                                                                                                                          |
| queue wait (fixed)           | 10 s    | A request still waiting then fails with `UnavailableError` (503, `Retry-After: 5`).                                                                 |
| `PDF_RENDER_TIMEOUT_MS`      | 30000   | The engine receives an `AbortSignal`; at the deadline the request fails with `UnavailableError` (503, `Retry-After: 5`) and the permit is released. |
| PDF size cap (fixed)         | 2 MB    | Larger output fails with 422 `RENDER_TOO_LARGE` and an ERROR log naming the template reference (usually an unoptimised image).                      |

Each successful render logs `pdf_rendered` with `{ reference, durationMs, bytes, queuedMs }` (no personal data). A permit is released on success, failure and timeout.

## Benchmark

`api/scripts/bench-render.ts` renders each template package 100 times sequentially and 10 times concurrently (after one warm-up render) and prints p50/p95/max time, PDF size and the RSS peak of the process.

```bash
# local, any package directories (default: the committed sample package)
npm ci
npm run bench:render -w @certificate-manager/api -- [package-dir ...]
```

Container run that mimics Cloud Run (512 MiB, one vCPU) from the repository root:

```bash
docker run --rm --memory=512m --cpus=1 \
  -v "$PWD":/repo -w /repo node:22 \
  sh -c 'npm ci && npm run bench:render -w @certificate-manager/api'
```

The script exits non-zero when a figure is over budget. Paste the output below with the date, commit and the host's CPU model. If a budget is missed, open an issue with the profile (`node --cpu-prof`).

## Results

### Local run, NOT in a container (no memory or CPU limit)

Sample package `api/test/fixtures/templates/good`, Node v22.23.3, Linux, 2026-11-11. Indicative only; it does not replace the container run.

| Scenario                | n   | p50   | p95   | max   | PDF max |
| ----------------------- | --- | ----- | ----- | ----- | ------- |
| sequential              | 100 | 9 ms  | 21 ms | 26 ms | 6 KB    |
| 10 concurrent (at once) | 10  | 95 ms | 95 ms | 95 ms | 6 KB    |

Peak RSS of the whole process: 179.4 MiB (budget 400 MiB).

### Container run (`--memory=512m --cpus=1`)

Not run yet. Needs Docker; to be recorded here.

The sample package is tiny (one logo, one font, 6 KB PDF). Results for the real reference templates (large background, several fonts) are still to be measured, so the acceptance criteria of #328 on budgets and peak RSS are not yet confirmed.
