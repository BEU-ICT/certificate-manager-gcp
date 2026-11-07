import { beforeEach, describe, expect, it } from 'vitest';
import {
  CachedTemplateAssets,
  templateKey,
  TEMPLATES_BUCKET,
  type TemplateAssetsOptions,
} from '../../src/modules/templates/index.js';
import type { BucketKind } from '../../src/ports/index.js';
import type { Template } from '../../src/shared/domain.js';
import { NotFoundError, UnavailableError } from '../../src/shared/errors.js';
import { asTemplateRef } from '../../src/shared/ids.js';
import { createFakes } from '../../src/testing/fakes/create-fakes.js';
import { FakeClock } from '../../src/testing/fakes/fake-clock.js';
import { FakeStorageGateway } from '../../src/testing/fakes/fake-storage-gateway.js';

/** Counts reads per key and can delay them to hold calls in flight. */
class CountingStorage extends FakeStorageGateway {
  readonly reads = new Map<string, number>();
  active = 0;
  maxActive = 0;
  delayMs = 0;
  failNext = 0;

  override async get(kind: BucketKind, key: string): Promise<Buffer | null> {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      if (this.failNext > 0) {
        this.failNext--;
        throw new UnavailableError();
      }
      return await super.get(kind, key);
    } finally {
      this.active--;
    }
  }

  get totalReads(): number {
    return [...this.reads.values()].reduce((a, b) => a + b, 0);
  }
}

const REF = 'acme-devfest-attendance-v0';

async function seed(
  fakes: ReturnType<typeof createFakes>,
  storage: FakeStorageGateway,
  reference: string,
  opts: {
    size?: number;
    fonts?: number;
    images?: string[];
    omit?: string;
    noBackground?: boolean;
  } = {},
) {
  const size = opts.size ?? 10;
  const fonts = Object.fromEntries(
    Array.from({ length: opts.fonts ?? 2 }, (_, i) => [`f${i}`, `fonts/f${i}.ttf`]),
  );
  const images = opts.images ?? ['assets/logo.png'];
  const template: Template = {
    reference: asTemplateRef(reference),
    organizationId: 'org-1' as never,
    eventId: 'ev-1' as never,
    organizationSlug: 'acme',
    eventSlug: 'devfest',
    type: 'attendance',
    version: 0,
    storagePath: `templates/${reference}/`,
    config: {
      ...(opts.noBackground ? {} : { background: 'background.svg' }),
      fonts,
      images: images.map((file) => ({ file })),
    },
    createdAt: new Date(),
    createdBy: 'admin',
    schemaVersion: 1,
  };
  await fakes.templates.create(template);
  const paths = ['background.svg', ...Object.values(fonts), ...new Set(images)];
  for (const path of paths) {
    if (path === opts.omit) continue;
    await storage.put(TEMPLATES_BUCKET, templateKey(reference, path), Buffer.alloc(size, 1), {
      contentType: 'application/octet-stream',
    });
  }
  return paths.length;
}

function setup(options: TemplateAssetsOptions = {}) {
  const fakes = createFakes();
  const storage = new CountingStorage();
  const clock = new FakeClock();
  const logs: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];
  const assets = new CachedTemplateAssets(fakes.templates, storage, clock, {
    logger: {
      info: (o) => logs.push(o),
      error: (o) => errors.push(o),
    },
    ...options,
  });
  return { fakes, storage, clock, assets, logs, errors };
}

describe('CachedTemplateAssets', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('loads background, fonts and images and reads each object once', async () => {
    const objects = await seed(t.fakes, t.storage, REF, { fonts: 2, images: ['assets/logo.png'] });
    const loaded = await t.assets.load(REF);
    expect(loaded.template.reference).toBe(REF);
    expect(loaded.background.length).toBe(10);
    expect([...loaded.fonts.keys()]).toEqual(['f0', 'f1']);
    expect([...loaded.images.keys()]).toEqual(['assets/logo.png']);
    expect(t.storage.totalReads).toBe(objects);
  });

  it('reads an image used twice only once', async () => {
    await seed(t.fakes, t.storage, REF, { fonts: 0, images: ['assets/a.png', 'assets/a.png'] });
    await t.assets.load(REF);
    expect(t.storage.totalReads).toBe(2);
  });

  it('serves a warm hit without storage reads, in under 1 ms', async () => {
    await seed(t.fakes, t.storage, REF);
    const first = await t.assets.load(REF);
    const reads = t.storage.totalReads;
    const hits = 100;
    const start = performance.now();
    for (let i = 0; i < hits - 1; i++) await t.assets.load(REF);
    const second = await t.assets.load(REF);
    expect((performance.now() - start) / hits).toBeLessThan(1);
    expect(second).toBe(first);
    expect(t.storage.totalReads).toBe(reads);
  });

  it('logs templateLoadMs, bytes and cache hit|miss without personal data', async () => {
    await seed(t.fakes, t.storage, REF, { fonts: 1, images: [] });
    await t.assets.load(REF);
    await t.assets.load(REF);
    expect(t.logs.map((l) => l['cache'])).toEqual(['miss', 'hit']);
    for (const log of t.logs) {
      expect(log['bytes']).toBe(20);
      expect(typeof log['templateLoadMs']).toBe('number');
      expect(Object.keys(log).sort()).toEqual(['bytes', 'cache', 'reference', 'templateLoadMs']);
    }
  });

  it('single-flights 10 concurrent calls into one read per object', async () => {
    const objects = await seed(t.fakes, t.storage, REF);
    t.storage.delayMs = 5;
    const results = await Promise.all(Array.from({ length: 10 }, () => t.assets.load(REF)));
    expect(new Set(results).size).toBe(1);
    expect(t.storage.totalReads).toBe(objects);
    for (const count of t.storage.reads.values()) expect(count).toBe(1);
  });

  it('never has more than 6 reads in flight', async () => {
    await seed(t.fakes, t.storage, REF, { fonts: 8, images: ['assets/a.png', 'assets/b.png'] });
    t.storage.delayMs = 5;
    await t.assets.load(REF);
    expect(t.storage.maxActive).toBe(6);
  });

  it('honours a custom concurrency', async () => {
    const c = setup({ concurrency: 2 });
    await seed(c.fakes, c.storage, REF, { fonts: 5 });
    c.storage.delayMs = 2;
    await c.assets.load(REF);
    expect(c.storage.maxActive).toBe(2);
  });

  it('expires entries after the TTL (30 minutes)', async () => {
    const objects = await seed(t.fakes, t.storage, REF);
    await t.assets.load(REF);
    t.clock.advance(30 * 60 * 1000 - 1);
    await t.assets.load(REF);
    expect(t.storage.totalReads).toBe(objects);
    t.clock.advance(1);
    await t.assets.load(REF);
    expect(t.storage.totalReads).toBe(objects * 2);
    expect(t.assets.size).toBe(objects * 10);
  });

  it('evicts least recently used entries by byte budget', async () => {
    // Each package: background + 1 font + 1 image of 100 bytes = 300 bytes; budget fits two.
    const c = setup({ maxBytes: 700 });
    const refs = ['a-v0', 'b-v0', 'c-v0'];
    for (const ref of refs) await seed(c.fakes, c.storage, ref, { size: 100, fonts: 1 });
    await c.assets.load('a-v0');
    await c.assets.load('b-v0');
    await c.assets.load('a-v0'); // a becomes most recent
    await c.assets.load('c-v0'); // evicts b
    expect(c.assets.size).toBe(600);
    const before = c.storage.totalReads;
    await c.assets.load('a-v0');
    await c.assets.load('c-v0');
    expect(c.storage.totalReads).toBe(before);
    await c.assets.load('b-v0');
    expect(c.storage.totalReads).toBe(before + 3);
  });

  it('returns but does not cache a package larger than the budget', async () => {
    const c = setup({ maxBytes: 100 });
    await seed(c.fakes, c.storage, REF, { size: 100, fonts: 0, images: [] });
    await seed(c.fakes, c.storage, 'big-v0', { size: 60, fonts: 1, images: [] });
    const loaded = await c.assets.load('big-v0');
    expect(loaded.background.length).toBe(60);
    expect(c.assets.size).toBe(0);
  });

  it('does not cache errors: the next call retries', async () => {
    const objects = await seed(t.fakes, t.storage, REF);
    t.storage.failNext = 1;
    await expect(t.assets.load(REF)).rejects.toBeInstanceOf(UnavailableError);
    const loaded = await t.assets.load(REF);
    expect(loaded.template.reference).toBe(REF);
    expect(t.assets.size).toBeGreaterThan(0);
    expect(t.storage.totalReads).toBeGreaterThanOrEqual(objects);
  });

  it('shares one failure between concurrent callers, then recovers', async () => {
    await seed(t.fakes, t.storage, REF, { fonts: 0, images: [] });
    t.storage.delayMs = 3;
    t.storage.failNext = 1;
    const results = await Promise.allSettled([t.assets.load(REF), t.assets.load(REF)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    await expect(t.assets.load(REF)).resolves.toBeDefined();
  });

  describe('NotFoundError', () => {
    it('for a missing template document', async () => {
      await expect(t.assets.load('nope-v0')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('for a malformed reference without touching the repository', async () => {
      await expect(t.assets.load('../x')).rejects.toBeInstanceOf(NotFoundError);
      expect(t.storage.totalReads).toBe(0);
    });

    it('for a missing object, logged as ERROR with the reference, and not cached', async () => {
      await seed(t.fakes, t.storage, REF, { omit: 'fonts/f1.ttf' });
      await expect(t.assets.load(REF)).rejects.toBeInstanceOf(NotFoundError);
      expect(t.errors).toEqual([{ reference: REF }]);
      expect(t.assets.size).toBe(0);
      await t.storage.put(TEMPLATES_BUCKET, templateKey(REF, 'fonts/f1.ttf'), Buffer.alloc(10), {
        contentType: 'font/ttf',
      });
      await expect(t.assets.load(REF)).resolves.toBeDefined();
    });

    it('for a stored config without a background', async () => {
      await seed(t.fakes, t.storage, REF, { noBackground: true });
      await expect(t.assets.load(REF)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
