// Render benchmark (`npm run bench:render -w @certificate-manager/api -- [package-dir ...]`).
// Runs 100 sequential and 10 concurrent renders of each template package (default: the committed
// sample package) through DefaultPdfService and prints p50/p95/max time, RSS peak and PDF size.
// To mimic Cloud Run run it in a container with `--memory=512m --cpus=1` (docs/performance.md).
// Budgets (BEU-ICT/certificate-manager#236 section 7): p95 <= 5 s, peak RSS <= 400 MiB, PDF <= 2 MB.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DefaultPdfService,
  InMemoryRendererRegistry,
  RenderLimiter,
  SvgPdfRenderer,
  createFields,
  drawQr,
  type RenderInput,
} from '../src/modules/pdf/index.js';
import type { LoadedTemplate, TemplateAssets } from '../src/modules/templates/index.js';
import type { Certificate, Template } from '../src/shared/domain.js';

const SEQUENTIAL = 100;
const CONCURRENT = 10;
const BUDGET = { p95Ms: 5000, rssMiB: 400, pdfBytes: 2 * 1024 * 1024 };
const SAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test/fixtures/templates/good',
);

async function loadPackage(dir: string): Promise<LoadedTemplate> {
  const read = (file: string): Promise<Buffer> => readFile(path.join(dir, file));
  const config = JSON.parse((await read('config.json')).toString('utf8')) as Record<
    string,
    unknown
  >;
  const fonts = new Map<string, Buffer>();
  for (const [key, file] of Object.entries((config['fonts'] ?? {}) as Record<string, string>)) {
    fonts.set(key, await read(file));
  }
  const images = new Map<string, Buffer>();
  for (const image of (config['images'] ?? []) as { file: string }[]) {
    images.set(image.file, await read(image.file));
  }
  const reference = path.basename(dir);
  return {
    template: {
      reference,
      organizationId: 'org',
      eventId: 'evt',
      organizationSlug: 'bench',
      eventSlug: 'bench',
      type: 'attendance',
      version: 1,
      storagePath: `templates/${reference}/`,
      config,
      createdAt: new Date(0),
      createdBy: 'bench',
      schemaVersion: 1,
    } as unknown as Template,
    background: await read(String(config['background'])),
    fonts,
    images,
  };
}

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
const mib = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

let peakRss = 0;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 20);

function stats(label: string, times: number[], sizes: number[]): boolean {
  const sorted = [...times].sort((a, b) => a - b);
  const p95 = percentile(sorted, 95);
  const maxPdf = Math.max(...sizes);
  const ok = p95 <= BUDGET.p95Ms && maxPdf <= BUDGET.pdfBytes;
  process.stdout.write(
    `  ${label.padEnd(26)} n=${String(times.length).padStart(3)}  p50=${percentile(sorted, 50).toFixed(0)} ms  p95=${p95.toFixed(0)} ms  max=${(sorted.at(-1) ?? 0).toFixed(0)} ms  pdf max=${(maxPdf / 1024).toFixed(0)} KB  ${ok ? 'within' : 'OVER'} budget\n`,
  );
  return ok;
}

async function benchTemplate(dir: string): Promise<boolean> {
  const loaded = await loadPackage(dir);
  const assets: TemplateAssets = { load: () => Promise.resolve(loaded) };
  const fields = createFields();
  const registry = new InMemoryRendererRegistry();
  registry.register(
    new SvgPdfRenderer({
      fieldsLayer: fields.fieldsLayer,
      fitChecker: fields.checkFit,
      qrLayer: drawQr,
    }),
  );
  const service = new DefaultPdfService(
    registry,
    assets,
    (c) => `https://certs.example.test/c/${c.id}`,
    {
      // All CONCURRENT renders run at once so the test measures peak memory, not queueing.
      limiter: new RenderLimiter({ maxConcurrent: CONCURRENT }),
    },
  );
  const reference = loaded.template.reference;
  const input = (i: number): RenderInput => ({
    ownerName: `Participant ${i}`,
    subject: 'Benchmark event 2026',
    skills: ['TypeScript', 'Cloud Run'],
    issuedAt: new Date('2026-11-03T23:30:00.000Z'),
    organizationName: 'Bench',
    type: 'attendance',
    publicUrl: `https://certs.example.test/c/${String(i).padStart(22, 'x')}`,
  });
  const timed = async (i: number): Promise<{ ms: number; bytes: number }> => {
    const started = performance.now();
    const pdf = await service.preview(reference, input(i));
    return { ms: performance.now() - started, bytes: pdf.length };
  };

  process.stdout.write(`${reference}\n`);
  await timed(0); // warm-up (font parsing, JIT) is excluded from the figures
  const sequential: { ms: number; bytes: number }[] = [];
  for (let i = 0; i < SEQUENTIAL; i += 1) sequential.push(await timed(i));
  const okSeq = stats(
    'sequential',
    sequential.map((r) => r.ms),
    sequential.map((r) => r.bytes),
  );
  const concurrent = await Promise.all(Array.from({ length: CONCURRENT }, (_, i) => timed(i)));
  const okCon = stats(
    'concurrent (all at once)',
    concurrent.map((r) => r.ms),
    concurrent.map((r) => r.bytes),
  );
  return okSeq && okCon;
}

const dirs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
let allOk = true;
for (const dir of dirs.length > 0 ? dirs : [SAMPLE_DIR]) {
  allOk = (await benchTemplate(path.resolve(dir))) && allOk;
}
clearInterval(sampler);
peakRss = Math.max(peakRss, process.memoryUsage().rss);
const rssOk = peakRss / 1024 / 1024 <= BUDGET.rssMiB;
process.stdout.write(
  `node ${process.version}, peak RSS ${mib(peakRss)} MiB (budget ${BUDGET.rssMiB}) ${rssOk ? 'within' : 'OVER'} budget\n`,
);
process.exit(allOk && rssOk ? 0 : 1);
