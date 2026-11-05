import { z } from 'zod';
import type { Clock, StorageGateway, TemplateRepository } from '../../ports/index.js';
import type { Template } from '../../shared/domain.js';
import { NotFoundError } from '../../shared/errors.js';
import { isTemplateRef } from '../../shared/ids.js';
import { TEMPLATES_BUCKET, templateKey } from './storage-keys.js';

/** Everything a render needs from one template package. Buffers are shared: treat as read-only. */
export interface LoadedTemplate {
  template: Template;
  background: Buffer;
  /** Keyed by the font name used in `config.fonts` / `fields.<name>.font`. */
  fonts: Map<string, Buffer>;
  /** Keyed by the package path used in `config.images[].file` (e.g. `assets/logo.png`). */
  images: Map<string, Buffer>;
}

export interface TemplateAssets {
  /**
   * Loads the template document and its files. Templates are immutable, so results are cached by
   * reference (LRU with a byte budget and a TTL); concurrent loads of one reference share one
   * storage read set. `NotFoundError` when the document, or any object it needs, is missing;
   * failures are never cached.
   */
  load(reference: string): Promise<LoadedTemplate>;
}

/** Minimal logger shape (pino-compatible) so the module needs no logging dependency. */
export interface AssetsLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface TemplateAssetsOptions {
  /** Cache byte budget; `0` disables caching (single-flight still applies). Default 40 MiB. */
  maxBytes?: number;
  /** Per-entry time to live. Default 30 minutes. */
  ttlMs?: number;
  /** Maximum concurrent storage reads. Default 6. */
  concurrency?: number;
  logger?: AssetsLogger;
  /** Monotonic millisecond timer for `templateLoadMs`; default `performance.now`. */
  timer?: () => number;
}

export const DEFAULT_TEMPLATE_CACHE_MB = 40;
export const TEMPLATE_CACHE_TTL_MS = 30 * 60 * 1000;
export const TEMPLATE_LOAD_CONCURRENCY = 6;

const packageSchema = z.object({
  background: z.string().min(1),
  fonts: z.record(z.string(), z.string().min(1)).default({}),
  images: z.array(z.object({ file: z.string().min(1) })).default([]),
});

interface CacheEntry {
  value: LoadedTemplate;
  bytes: number;
  expiresAt: number;
}

/** Counting semaphore bounding concurrent storage reads across all loads. */
class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next)
        next(); // hand the slot over
      else this.active--;
    }
  }
}

export class CachedTemplateAssets implements TemplateAssets {
  private readonly cache = new Map<string, CacheEntry>(); // insertion order = LRU order
  private readonly inFlight = new Map<string, Promise<LoadedTemplate>>();
  private readonly limiter: Limiter;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly timer: () => number;
  private cachedBytes = 0;

  constructor(
    private readonly repository: TemplateRepository,
    private readonly storage: StorageGateway,
    private readonly clock: Clock,
    private readonly options: TemplateAssetsOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? DEFAULT_TEMPLATE_CACHE_MB * 1024 * 1024;
    this.ttlMs = options.ttlMs ?? TEMPLATE_CACHE_TTL_MS;
    this.limiter = new Limiter(options.concurrency ?? TEMPLATE_LOAD_CONCURRENCY);
    this.timer = options.timer ?? (() => performance.now());
  }

  /** Bytes currently held by the cache (for tests and diagnostics). */
  get size(): number {
    return this.cachedBytes;
  }

  async load(reference: string): Promise<LoadedTemplate> {
    if (!isTemplateRef(reference)) throw new NotFoundError('Template not found');
    const started = this.timer();
    const now = this.clock.now().getTime();
    const hit = this.cache.get(reference);
    if (hit) {
      if (hit.expiresAt > now) {
        this.cache.delete(reference); // refresh recency
        this.cache.set(reference, hit);
        this.logLoad(reference, started, hit.bytes, 'hit');
        return hit.value;
      }
      this.evict(reference);
    }

    let pending = this.inFlight.get(reference);
    if (!pending) {
      pending = this.fetch(reference).finally(() => this.inFlight.delete(reference));
      this.inFlight.set(reference, pending);
    }
    const value = await pending;
    this.logLoad(reference, started, bytesOf(value), 'miss');
    return value;
  }

  private async fetch(reference: string): Promise<LoadedTemplate> {
    try {
      const value = await this.read(reference);
      this.store(reference, value);
      return value;
    } catch (error) {
      if (error instanceof NotFoundError) {
        // Immutable packages never lose objects: missing data means corruption.
        this.options.logger?.error({ reference }, 'template package incomplete or config invalid');
      }
      throw error;
    }
  }

  private async read(reference: string): Promise<LoadedTemplate> {
    // `isTemplateRef` was checked by the caller.
    const template = await this.repository.getByReference(reference as Template['reference']);
    if (!template) throw new NotFoundError('Template not found');
    const parsed = packageSchema.safeParse(template.config);
    if (!parsed.success)
      throw new NotFoundError(
        'Template config invalid: background, fonts or images missing or malformed',
      );
    const { background, fonts, images } = parsed.data;

    const fetchFile = (path: string): Promise<Buffer> =>
      this.limiter.run(async () => {
        const body = await this.storage.get(TEMPLATES_BUCKET, templateKey(reference, path));
        if (body === null) throw new NotFoundError('Template file not found');
        return body;
      });

    // One read per distinct path, even when a path is referenced twice.
    const reads = new Map<string, Promise<Buffer>>();
    const once = (path: string): Promise<Buffer> => {
      let read = reads.get(path);
      if (!read) {
        read = fetchFile(path);
        reads.set(path, read);
      }
      return read;
    };
    const backgroundBody = once(background);
    const fontEntries = Object.entries(fonts).map(
      async ([name, path]) => [name, await once(path)] as const,
    );
    const imageEntries = [...new Set(images.map((i) => i.file))].map(
      async (path) => [path, await once(path)] as const,
    );
    // allSettled so a failure never leaves a rejected sibling unhandled.
    const settled = await Promise.allSettled([backgroundBody, ...fontEntries, ...imageEntries]);
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;

    return {
      template,
      background: await backgroundBody,
      fonts: new Map(await Promise.all(fontEntries)),
      images: new Map(await Promise.all(imageEntries)),
    };
  }

  private store(reference: string, value: LoadedTemplate): void {
    const bytes = bytesOf(value);
    if (bytes > this.maxBytes) return; // never cache what cannot fit; the caller still gets it
    this.evict(reference);
    this.cache.set(reference, {
      value,
      bytes,
      expiresAt: this.clock.now().getTime() + this.ttlMs,
    });
    this.cachedBytes += bytes;
    for (const key of this.cache.keys()) {
      if (this.cachedBytes <= this.maxBytes) break;
      this.evict(key); // least recently used first
    }
  }

  private evict(reference: string): void {
    const entry = this.cache.get(reference);
    if (!entry) return;
    this.cache.delete(reference);
    this.cachedBytes -= entry.bytes;
  }

  private logLoad(reference: string, started: number, bytes: number, cache: 'hit' | 'miss'): void {
    this.options.logger?.info(
      {
        reference,
        templateLoadMs: Math.round((this.timer() - started) * 1000) / 1000,
        bytes,
        cache,
      },
      'template loaded',
    );
  }
}

function bytesOf(value: LoadedTemplate): number {
  let total = value.background.length;
  for (const buffer of value.fonts.values()) total += buffer.length;
  for (const buffer of value.images.values()) total += buffer.length;
  return total;
}
