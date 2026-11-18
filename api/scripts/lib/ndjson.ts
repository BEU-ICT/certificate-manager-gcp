/**
 * NDJSON export/import of every collection (BEU-ICT/certificate-manager#439, spec §5.1 rule 8).
 *
 * Export reads through the repository ports (any `DB_ADAPTER`), streaming page by page with
 * cursors, and writes one file per collection plus `manifest.json` (count and SHA-256 per file).
 * Records are canonical JSON (sorted keys, timestamps as ISO strings), so exporting the same data
 * from two adapters gives byte-identical files. Import verifies the manifest first, validates every
 * record with zod, then upserts by id (PostgreSQL) or creates missing records (other adapters).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  upsertCertificates,
  upsertEvents,
  upsertOrganizations,
  upsertTemplates,
} from '../../src/adapters/postgres/upsert.js';
import type { Page, StorageGateway } from '../../src/ports/index.js';
import { CERTIFICATE_TYPES } from '../../src/shared/certificate-types.js';
import type {
  Certificate,
  CertificateEvent,
  Organization,
  Template,
} from '../../src/shared/domain.js';
import { ConflictError } from '../../src/shared/errors.js';
import { canonicalJson } from '../../src/shared/idempotency.js';
import type { RepositoryPorts } from '../../src/wiring.js';

export const FORMAT = 'certificate-manager-ndjson/1';
export const COLLECTIONS = ['organizations', 'events', 'templates', 'certificates'] as const;
export type Collection = (typeof COLLECTIONS)[number];
export const OBJECTS_FILE = 'objects.ndjson';
const fileName = (c: Collection | 'objects') => `${c}.ndjson`;
const PAGE = 500;
const BATCH = 500;

// ---------------------------------------------------------------------------------- schemas

const iso = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const id = z.string().min(1).max(200);
const schemaVersion = z.number().int().min(1);

export const organizationSchema = z
  .object({
    id,
    slug: z.string().min(1).max(100),
    name: z.string().min(1).max(500),
    createdAt: iso,
    updatedAt: iso,
    schemaVersion,
  })
  .strict();

export const eventSchema = z
  .object({
    id,
    organizationId: id,
    slug: z.string().min(1).max(100),
    name: z.string().min(1).max(500),
    emailLanguage: z.enum(['az', 'en']),
    createdAt: iso,
    updatedAt: iso,
    schemaVersion,
  })
  .strict();

export const templateSchema = z
  .object({
    reference: id,
    organizationId: id,
    eventId: id,
    organizationSlug: z.string().min(1),
    eventSlug: z.string().min(1),
    type: z.enum(CERTIFICATE_TYPES),
    version: z.number().int().min(0),
    storagePath: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    createdAt: iso,
    createdBy: z.string().min(1),
    schemaVersion,
  })
  .strict();

export const certificateSchema = z
  .object({
    id,
    organizationId: id,
    eventId: id,
    organizationName: z.string(),
    eventName: z.string(),
    templateId: z.string().min(1),
    type: z.enum(CERTIFICATE_TYPES),
    ownerName: z.string().min(1),
    email: z.string().optional(),
    subject: z.string(),
    skills: z.array(z.string()),
    status: z.enum(['active', 'revoked']),
    issuedAt: iso,
    revokedAt: iso.optional(),
    revokeReason: z.string().optional(),
    emailStatus: z.enum(['pending', 'sent', 'failed', 'skipped']),
    emailAttempts: z.number().int().min(0),
    emailSentAt: iso.optional(),
    emailLastError: z.string().optional(),
    pdfPath: z.string().optional(),
    pdfGeneratedAt: iso.optional(),
    legacy: z
      .object({
        id: z.string(),
        certificateType: z.string().optional(),
        template: z.string().optional(),
      })
      .strict()
      .optional(),
    createdBy: z.string().min(1),
    createdAt: iso,
    updatedAt: iso,
    schemaVersion,
  })
  .strict();

export const objectSchema = z
  .object({
    kind: z.enum(['templates', 'pdfs']),
    key: z.string().min(1),
    contentType: z.string().min(1),
    size: z.number().int().min(0),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type ObjectRecord = z.infer<typeof objectSchema>;

const schemas = {
  organizations: organizationSchema,
  events: eventSchema,
  templates: templateSchema,
  certificates: certificateSchema,
} as const;

export interface FileEntry {
  count: number;
  sha256: string;
}
export interface Manifest {
  format: typeof FORMAT;
  schemaVersion: number;
  exportedAt: string;
  files: Record<string, FileEntry>;
}

export interface Logger {
  info: (message: string) => void;
}

// ---------------------------------------------------------------------------------- export

/** One output file: counts lines and hashes the bytes while writing (backpressure aware). */
class NdjsonFile {
  private readonly stream: WriteStream;
  private readonly hash = createHash('sha256');
  count = 0;

  constructor(readonly file: string) {
    this.stream = createWriteStream(file, { mode: 0o600 });
  }

  async write(record: unknown): Promise<void> {
    const line = `${canonicalJson(record)}\n`;
    this.hash.update(line);
    this.count++;
    if (!this.stream.write(line)) {
      await new Promise<void>((resolve) => this.stream.once('drain', resolve));
    }
  }

  async close(): Promise<FileEntry> {
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(resolve);
    });
    return { count: this.count, sha256: this.hash.digest('hex') };
  }
}

async function* pages<T>(
  next: (cursor: Page<T>['nextCursor']) => Promise<Page<T>>,
): AsyncGenerator<T> {
  let cursor: Page<T>['nextCursor'] = null;
  do {
    const page: Page<T> = await next(cursor);
    yield* page.items;
    cursor = page.nextCursor;
  } while (cursor !== null);
}

function contentTypeOf(key: string): string {
  const ext = path.extname(key).toLowerCase();
  const types: Record<string, string> = {
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ttf': 'font/ttf',
    '.pdf': 'application/pdf',
  };
  return types[ext] ?? 'application/octet-stream';
}

/** Signature of the manifest bytes: hex HMAC-SHA256 (optional, key from the environment). */
export const signManifest = (manifest: string, key: string): string =>
  createHmac('sha256', key).update(manifest).digest('hex');

export interface ExportOptions {
  repos: RepositoryPorts;
  outDir: string;
  /** Also copy template package files and PDFs into `<outDir>/files/`. */
  storage?: StorageGateway;
  signKey?: string;
  log?: Logger;
}

export async function exportNdjson(options: ExportOptions): Promise<Manifest> {
  const { repos, outDir, storage, log } = options;
  // 0700: the export holds personal data (names, e-mail addresses).
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await chmod(outDir, 0o700);
  const files: Record<string, FileEntry> = {};
  const pdfKeys: string[] = [];
  const templatePrefixes: string[] = [];

  const streams: Record<Collection, () => AsyncGenerator<unknown>> = {
    organizations: () =>
      pages((cursor) =>
        repos.organizations.list({ limit: PAGE, bulk: true, ...(cursor && { cursor }) }),
      ),
    events: () =>
      pages((cursor) =>
        repos.events.list({}, { limit: PAGE, bulk: true, ...(cursor && { cursor }) }),
      ),
    templates: () =>
      pages((cursor) =>
        repos.templates.list({}, { limit: PAGE, bulk: true, ...(cursor && { cursor }) }),
      ),
    certificates: () =>
      pages((cursor) =>
        repos.certificates.list({}, { limit: PAGE, bulk: true, ...(cursor && { cursor }) }),
      ),
  };

  for (const collection of COLLECTIONS) {
    const out = new NdjsonFile(path.join(outDir, fileName(collection)));
    for await (const item of streams[collection]()) {
      if (collection === 'certificates' && (item as Certificate).pdfPath !== undefined) {
        pdfKeys.push((item as Certificate).pdfPath as string);
      }
      if (collection === 'templates') templatePrefixes.push((item as Template).storagePath);
      await out.write(item);
    }
    files[fileName(collection)] = await out.close();
    log?.info(`exported ${String(files[fileName(collection)]?.count)} ${collection}`);
  }

  if (storage !== undefined) {
    const out = new NdjsonFile(path.join(outDir, OBJECTS_FILE));
    const copy = async (kind: 'templates' | 'pdfs', key: string): Promise<void> => {
      const body = await storage.get(kind, key);
      if (body === null) return;
      const target = path.join(outDir, 'files', kind, key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, body, { mode: 0o600 });
      await out.write({
        kind,
        key,
        contentType: contentTypeOf(key),
        size: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      } satisfies ObjectRecord);
    };
    for (const prefix of templatePrefixes) {
      for (const object of await storage.list('templates', prefix))
        await copy('templates', object.key);
    }
    for (const key of pdfKeys) await copy('pdfs', key);
    files[OBJECTS_FILE] = await out.close();
    log?.info(`exported ${String(files[OBJECTS_FILE]?.count)} storage objects`);
  }

  const manifest: Manifest = {
    format: FORMAT,
    schemaVersion: await readSchemaVersion(),
    exportedAt: new Date().toISOString(),
    files,
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(outDir, 'manifest.json'), text, { mode: 0o600 });
  if (options.signKey !== undefined) {
    await writeFile(path.join(outDir, 'manifest.sig'), `${signManifest(text, options.signKey)}\n`, {
      mode: 0o600,
    });
  }
  return manifest;
}

async function readSchemaVersion(): Promise<number> {
  return (await import('../../src/shared/schema-version.js')).SCHEMA_VERSION;
}

// ---------------------------------------------------------------------------------- import

export interface Reject {
  file: string;
  line: number;
  error: string;
}

export interface ImportReport {
  dryRun: boolean;
  /** Records written (or that would be written) per collection. */
  imported: Record<string, number>;
  /** Records that already existed and were left alone (adapters without upsert). */
  skipped: Record<string, number>;
  rejects: Reject[];
  objects: number;
}

export interface ImportOptions {
  repos: RepositoryPorts;
  inDir: string;
  dryRun?: boolean;
  /** PostgreSQL pool: enables idempotent upserts. Without it records are created via the ports. */
  pool?: Pool;
  storage?: StorageGateway;
  signKey?: string;
  log?: Logger;
}

export class ImportError extends Error {
  override readonly name = 'ImportError';
}

async function* lines(file: string): AsyncGenerator<{ text: string; line: number }> {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let line = 0;
  for await (const text of rl) {
    line++;
    if (text.trim() !== '') yield { text, line };
  }
}

async function digest(file: string): Promise<FileEntry> {
  const hash = createHash('sha256');
  let count = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    for (const byte of chunk as Buffer) if (byte === 0x0a) count++;
  }
  return { count, sha256: hash.digest('hex') };
}

/** Verifies the manifest (signature if present and a key given, counts, checksums). Throws on mismatch. */
export async function verifyExport(inDir: string, signKey?: string): Promise<Manifest> {
  const text = await readFile(path.join(inDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(text) as Manifest;
  if (manifest.format !== FORMAT)
    throw new ImportError(`unsupported export format "${String(manifest.format)}"`);
  if (signKey !== undefined) {
    const sig = await readFile(path.join(inDir, 'manifest.sig'), 'utf8').catch(() => '');
    const expected = Buffer.from(signManifest(text, signKey));
    const actual = Buffer.from(sig.trim());
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ImportError('manifest signature is missing or does not match');
    }
  }
  for (const collection of COLLECTIONS) {
    if (manifest.files[fileName(collection)] === undefined) {
      throw new ImportError(`manifest has no entry for ${fileName(collection)}`);
    }
  }
  for (const [name, entry] of Object.entries(manifest.files)) {
    const actual = await digest(path.join(inDir, name));
    if (actual.count !== entry.count) {
      throw new ImportError(
        `${name}: manifest says ${String(entry.count)} records, file has ${String(actual.count)}`,
      );
    }
    if (actual.sha256 !== entry.sha256) throw new ImportError(`${name}: checksum mismatch`);
  }
  return manifest;
}

type Entity = Organization | CertificateEvent | Template | Certificate;

export async function importNdjson(options: ImportOptions): Promise<ImportReport> {
  const { repos, inDir, pool, storage, log } = options;
  const dryRun = options.dryRun ?? false;
  const manifest = await verifyExport(inDir, options.signKey);
  const report: ImportReport = { dryRun, imported: {}, skipped: {}, rejects: [], objects: 0 };

  /** Writes the batch; resolves to the number of records that already existed (generic adapters). */
  const write = async (collection: Collection, batch: Entity[]): Promise<number> => {
    if (pool !== undefined) {
      const run = {
        organizations: () => upsertOrganizations(pool, batch as Organization[]),
        events: () => upsertEvents(pool, batch as CertificateEvent[]),
        templates: () => upsertTemplates(pool, batch as Template[]),
        certificates: () => upsertCertificates(pool, batch as Certificate[]),
      }[collection];
      await run();
      return 0;
    }
    let existing = 0;
    for (const item of batch) {
      try {
        if (collection === 'organizations') await repos.organizations.create(item as Organization);
        else if (collection === 'events') await repos.events.create(item as CertificateEvent);
        else if (collection === 'templates') await repos.templates.create(item as Template);
        else await repos.certificates.create(item as Certificate);
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        existing++;
      }
    }
    report.skipped[collection] = (report.skipped[collection] ?? 0) + existing;
    return existing;
  };

  for (const collection of COLLECTIONS) {
    const file = fileName(collection);
    let batch: { entity: Entity; line: number }[] = [];
    report.imported[collection] = 0;

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      const current = batch;
      batch = [];
      if (dryRun) {
        report.imported[collection] = (report.imported[collection] ?? 0) + current.length;
        return;
      }
      try {
        const existing = await write(
          collection,
          current.map((b) => b.entity),
        );
        report.imported[collection] =
          (report.imported[collection] ?? 0) + current.length - existing;
      } catch {
        // Isolate the failing records: retry one by one, report each failure as a reject.
        for (const item of current) {
          try {
            const existing = await write(collection, [item.entity]);
            report.imported[collection] = (report.imported[collection] ?? 0) + 1 - existing;
          } catch (error) {
            report.rejects.push({
              file,
              line: item.line,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    };

    for await (const { text, line } of lines(path.join(inDir, file))) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        report.rejects.push({ file, line, error: 'invalid JSON' });
        continue;
      }
      const result = schemas[collection].safeParse(parsed);
      if (!result.success) {
        report.rejects.push({
          file,
          line,
          error: result.error.issues
            .map((i) => `${i.path.join('.') || '(record)'}: ${i.message}`)
            .join('; '),
        });
        continue;
      }
      batch.push({ entity: result.data as unknown as Entity, line });
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    log?.info(
      `${dryRun ? 'validated' : 'imported'} ${String(report.imported[collection])}/${String(manifest.files[file]?.count)} ${collection}`,
    );
  }

  if (storage !== undefined && manifest.files[OBJECTS_FILE] !== undefined) {
    for await (const { text, line } of lines(path.join(inDir, OBJECTS_FILE))) {
      const parsed = objectSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        report.rejects.push({ file: OBJECTS_FILE, line, error: 'invalid object record' });
        continue;
      }
      const o = parsed.data;
      const body = await readFile(path.join(inDir, 'files', o.kind, o.key));
      if (createHash('sha256').update(body).digest('hex') !== o.sha256) {
        report.rejects.push({ file: OBJECTS_FILE, line, error: `checksum mismatch for ${o.key}` });
        continue;
      }
      if (!dryRun) await storage.put(o.kind, o.key, body, { contentType: o.contentType });
      report.objects++;
    }
    log?.info(`${dryRun ? 'validated' : 'copied'} ${String(report.objects)} storage objects`);
  }
  return report;
}
