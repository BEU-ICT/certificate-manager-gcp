import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DefaultPdfService,
  InMemoryRendererRegistry,
  MAX_PDF_BYTES,
  RENDER_TOO_LARGE,
  RenderLimiter,
  SvgPdfRenderer,
  type PdfLogger,
  type RenderAssets,
  type RenderInput,
  type TemplateRenderer,
} from '../../src/modules/pdf/index.js';
import type { TemplateAssets } from '../../src/modules/templates/index.js';
import { SAMPLE_INPUT, loadSampleAssets } from '../helpers/svg-pdf-fixture.js';
import { UnavailableError, UnprocessableError } from '../../src/shared/errors.js';
import type { Template } from '../../src/shared/domain.js';

interface Gate {
  promise: Promise<void>;
  open: () => void;
}
function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RenderLimiter', () => {
  it('runs at most N tasks at once and queues the rest in order', async () => {
    const limiter = new RenderLimiter({ maxConcurrent: 2 });
    const gates = [gate(), gate(), gate(), gate()];
    const started: number[] = [];
    const runs = gates.map((g, i) =>
      limiter.run(async () => {
        started.push(i);
        await g.promise;
        return i;
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 1]);
    expect(limiter.inFlight).toBe(2);
    expect(limiter.waiting).toBe(2);

    gates[0]?.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 1, 2]);
    gates[1]?.open();
    gates[2]?.open();
    gates[3]?.open();
    const results = await Promise.all(runs);
    expect(results.map((r) => r.value)).toEqual([0, 1, 2, 3]);
    expect(limiter.inFlight).toBe(0);
    expect(limiter.waiting).toBe(0);
  });

  it('reports the queue wait of a request', async () => {
    let now = 0;
    const limiter = new RenderLimiter({ maxConcurrent: 1, timer: () => now });
    const first = gate();
    const a = limiter.run(() => first.promise);
    const b = limiter.run(() => Promise.resolve('b'));
    await vi.advanceTimersByTimeAsync(0);
    now = 250;
    first.open();
    expect((await a).queuedMs).toBe(0);
    expect((await b).queuedMs).toBe(250);
  });

  it('aborts at the timeout, rejects with 503 and frees the permit', async () => {
    const limiter = new RenderLimiter({ maxConcurrent: 1, timeoutMs: 1000 });
    let signal: AbortSignal | undefined;
    const hung = limiter.run((s) => {
      signal = s;
      return new Promise<never>(() => undefined); // ignores the signal, never settles
    });
    const caught = hung.catch((error: unknown) => error);
    const next = limiter.run(() => Promise.resolve('next'));
    await vi.advanceTimersByTimeAsync(1000);
    const error = await caught;
    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as UnavailableError).statusCode).toBe(503);
    expect((error as UnavailableError).headers).toEqual({ 'retry-after': '5' });
    expect((error as UnavailableError).message).toBe('PDF rendering timed out');
    expect(signal?.aborted).toBe(true);
    expect((await next).value).toBe('next');
    expect(limiter.inFlight).toBe(0);
  });

  it('fails a request that waits longer than the queue limit with 503 and Retry-After 5', async () => {
    const limiter = new RenderLimiter({ maxConcurrent: 1, queueWaitMs: 10_000, timeoutMs: 60_000 });
    const hold = gate();
    const holder = limiter.run(() => hold.promise);
    const waiter = limiter.run(() => Promise.resolve('never'));
    const caught = waiter.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(limiter.waiting).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await caught;
    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as UnavailableError).statusCode).toBe(503);
    expect((error as UnavailableError).headers).toEqual({ 'retry-after': '5' });
    expect(limiter.waiting).toBe(0);
    hold.open();
    await holder;
    expect(limiter.inFlight).toBe(0);
  });

  it('releases the permit when the task fails', async () => {
    const limiter = new RenderLimiter({ maxConcurrent: 1 });
    for (let i = 0; i < 3; i += 1) {
      await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
      expect(limiter.inFlight).toBe(0);
    }
    expect((await limiter.run(() => Promise.resolve(1))).value).toBe(1);
  });

  it('hands a freed permit to a waiter instead of leaking it on failure', async () => {
    const limiter = new RenderLimiter({ maxConcurrent: 1 });
    const first = gate();
    const a = limiter.run(async () => {
      await first.promise;
      throw new Error('boom');
    });
    const aResult = a.catch((error: unknown) => error);
    const b = limiter.run(() => Promise.resolve('b'));
    await vi.advanceTimersByTimeAsync(0);
    first.open();
    await aResult;
    expect((await b).value).toBe('b');
    expect(limiter.inFlight).toBe(0);
  });
});

const REF = 'acme-devfest-attendance-v0';
const template = {
  reference: REF,
  config: { engine: 'dummy' },
} as unknown as Template;

function setup(render: TemplateRenderer['render'], logger?: PdfLogger, maxPdfBytes?: number) {
  const registry = new InMemoryRendererRegistry();
  registry.register({ engine: 'dummy', render, checkFit: () => ({ fits: true, issues: [] }) });
  const assets: TemplateAssets = {
    load: () =>
      Promise.resolve({
        template,
        background: Buffer.alloc(0),
        fonts: new Map(),
        images: new Map(),
      } satisfies RenderAssets),
  };
  const limiter = new RenderLimiter({ maxConcurrent: 1 });
  const options = {
    limiter,
    ...(logger ? { logger } : {}),
    ...(maxPdfBytes !== undefined ? { maxPdfBytes } : {}),
  };
  const service = new DefaultPdfService(registry, assets, () => 'https://x.test/c/1', options);
  return { service, limiter };
}

const sample: RenderInput = {
  ownerName: 'Ada Lovelace',
  subject: 'DevFest',
  skills: [],
  issuedAt: new Date(0),
  type: 'attendance',
  publicUrl: 'https://x.test/c/1',
};

function recorder() {
  const infos: { obj: Record<string, unknown>; msg: string }[] = [];
  const errors: { obj: Record<string, unknown>; msg: string }[] = [];
  const logger: PdfLogger = {
    info: (obj, msg) => infos.push({ obj, msg }),
    error: (obj, msg) => errors.push({ obj, msg }),
  };
  return { logger, infos, errors };
}

describe('DefaultPdfService render guard', () => {
  it('logs pdf_rendered with reference, durationMs, bytes and queuedMs only', async () => {
    const { logger, infos } = recorder();
    const { service } = setup(() => Promise.resolve(Buffer.alloc(1234)), logger);
    await service.preview(REF, sample);
    expect(infos).toHaveLength(1);
    expect(infos[0]?.msg).toBe('pdf_rendered');
    expect(Object.keys(infos[0]?.obj ?? {}).sort()).toEqual([
      'bytes',
      'durationMs',
      'queuedMs',
      'reference',
    ]);
    expect(infos[0]?.obj).toMatchObject({ reference: REF, bytes: 1234 });
    expect(JSON.stringify(infos)).not.toContain('Ada');
  });

  it('rejects a PDF over the cap, logs ERROR with the reference and releases the permit', async () => {
    const { logger, errors, infos } = recorder();
    const { service, limiter } = setup(
      () => Promise.resolve(Buffer.alloc(MAX_PDF_BYTES + 1)),
      logger,
    );
    const error = await service.preview(REF, sample).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableError);
    expect((error as UnprocessableError).code).toBe(RENDER_TOO_LARGE);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toMatchObject({ reference: REF, bytes: MAX_PDF_BYTES + 1 });
    expect(JSON.stringify((error as UnprocessableError).details)).not.toContain(REF);
    expect((error as UnprocessableError).details?.[0]?.message).toBe(
      'Rendered PDF exceeds 2 MB; check for unoptimised images',
    );
    expect(infos).toHaveLength(0);
    expect(limiter.inFlight).toBe(0);
  });

  it('accepts a PDF of exactly the cap', async () => {
    const { service } = setup(() => Promise.resolve(Buffer.alloc(MAX_PDF_BYTES)));
    await expect(service.preview(REF, sample)).resolves.toHaveLength(MAX_PDF_BYTES);
  });

  it('frees the permit when the engine throws, and passes an AbortSignal to the engine', async () => {
    let seen: AbortSignal | undefined;
    let fail = true;
    const { service, limiter } = setup((_input, _assets, options) => {
      seen = options?.signal;
      return fail ? Promise.reject(new Error('engine')) : Promise.resolve(Buffer.from('ok'));
    });
    await expect(service.preview(REF, sample)).rejects.toThrow('engine');
    expect(limiter.inFlight).toBe(0);
    fail = false;
    await expect(service.preview(REF, sample)).resolves.toEqual(Buffer.from('ok'));
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  it('defaults to a built-in limiter when none is given', async () => {
    const registry = new InMemoryRendererRegistry();
    registry.register({
      engine: 'dummy',
      render: () => Promise.resolve(Buffer.from('ok')),
      checkFit: () => ({ fits: true, issues: [] }),
    });
    const assets: TemplateAssets = {
      load: () =>
        Promise.resolve({
          template,
          background: Buffer.alloc(0),
          fonts: new Map(),
          images: new Map(),
        }),
    };
    const service = new DefaultPdfService(registry, assets, () => 'u');
    await expect(service.preview(REF, sample)).resolves.toEqual(Buffer.from('ok'));
  });
});

describe('SvgPdfRenderer abort', () => {
  it('rejects at once for an already aborted signal', async () => {
    const reason = new UnavailableError(5, 'PDF rendering timed out');
    const controller = new AbortController();
    controller.abort(reason);
    const layer = vi.fn();
    const renderer = new SvgPdfRenderer({ fieldsLayer: layer });
    await expect(
      renderer.render(SAMPLE_INPUT, loadSampleAssets(), { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(layer).not.toHaveBeenCalled();
  });

  it('stops between stages when the signal aborts mid-render', async () => {
    const controller = new AbortController();
    const qr = vi.fn();
    const renderer = new SvgPdfRenderer({
      fieldsLayer: () => controller.abort(new UnavailableError(5, 'PDF rendering timed out')),
      qrLayer: qr,
    });
    await expect(
      renderer.render(SAMPLE_INPUT, loadSampleAssets(), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(UnavailableError);
    expect(qr).not.toHaveBeenCalled();
  });
});
