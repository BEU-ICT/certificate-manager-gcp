import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createLogger } from '../../src/http/logging/logger.js';

const TRACE = '105445aa7843bc8bf206b12000100000';

function capture(): {
  lines: () => Record<string, unknown>[];
  raw: () => string;
  stream: Writable;
} {
  let out = '';
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  return {
    stream,
    raw: () => out,
    lines: () =>
      out
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('logging', () => {
  it('emits JSON lines with severity, message and RFC3339 timestamp, without pid/hostname', () => {
    const sink = capture();
    const logger = createLogger({ destination: sink.stream });
    logger.debug('d'); // below default level, dropped
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');
    const lines = sink.lines();
    expect(lines.map((l) => l['severity'])).toEqual(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);
    expect(lines.map((l) => l['message'])).toEqual(['i', 'w', 'e', 'f']);
    for (const line of lines) {
      expect(line['timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(line).not.toHaveProperty('pid');
      expect(line).not.toHaveProperty('hostname');
      expect(line).not.toHaveProperty('level');
    }
    const debug = capture();
    createLogger({ level: 'debug', destination: debug.stream }).debug('d');
    expect(debug.lines()[0]?.['severity']).toBe('DEBUG');
  });

  it('writes exactly one access-log line per request with route pattern and latency', async () => {
    const sink = capture();
    app = buildApp({ log: { destination: sink.stream } });
    app.get('/items/:id', (req) => {
      req.adminUid = 'admin-1';
      return {};
    });
    const res = await app.inject({ method: 'GET', url: '/items/abc?x=1' });
    const lines = sink.lines().filter((l) => l['message'] === 'request completed');
    expect(sink.lines()).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      severity: 'INFO',
      requestId: res.headers['x-request-id'],
      method: 'GET',
      route: '/items/:id',
      status: 200,
      adminUid: 'admin-1',
    });
    expect(typeof lines[0]?.['latencyMs']).toBe('number');
    expect(sink.raw()).not.toContain('/items/abc');
  });

  it('omits adminUid for anonymous requests', async () => {
    const sink = capture();
    app = buildApp({ log: { destination: sink.stream } });
    await app.inject({ method: 'GET', url: '/internal/healthz' });
    expect(sink.lines()[0]).not.toHaveProperty('adminUid');
  });

  it('adds the trace field only when GCP_PROJECT is set and the header is present', async () => {
    const withProject = capture();
    app = buildApp({ log: { destination: withProject.stream, gcpProject: 'my-proj' } });
    await app.inject({
      method: 'GET',
      url: '/internal/healthz',
      headers: { 'x-cloud-trace-context': `${TRACE}/123;o=1` },
    });
    expect(withProject.lines()[0]).toMatchObject({
      'logging.googleapis.com/trace': `projects/my-proj/traces/${TRACE}`,
      requestId: TRACE,
    });
    await app.close();

    const noProject = capture();
    app = buildApp({ log: { destination: noProject.stream } });
    await app.inject({
      method: 'GET',
      url: '/internal/healthz',
      headers: { 'x-cloud-trace-context': `${TRACE}/123;o=1` },
    });
    expect(noProject.lines()[0]).not.toHaveProperty('logging.googleapis.com/trace');
    expect(noProject.lines()[0]).toMatchObject({ requestId: TRACE });
  });

  it('never logs the Authorization header, cookie, query emails or request bodies', async () => {
    const sink = capture();
    app = buildApp({ log: { destination: sink.stream } });
    app.post('/echo', (req) => {
      req.log.info({ req: { headers: req.headers }, email: 'logged@secret.example' }, 'explicit');
      return {};
    });
    await app.inject({
      method: 'POST',
      url: '/echo?email=query-person@secret.example',
      headers: {
        authorization: 'Bearer super-secret-token',
        cookie: 'session=cookie-secret',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ email: 'body-person@secret.example', ownerName: 'Jane Secret' }),
    });
    const raw = sink.raw();
    expect(raw).not.toContain('super-secret-token');
    expect(raw).not.toContain('cookie-secret');
    expect(raw).not.toContain('secret.example');
    expect(raw).not.toContain('Jane Secret');
    expect(raw).toContain('[Redacted]');
    for (const line of sink.lines()) expect(line).toHaveProperty('severity');
  });

  it('redacts secret keys nested in logged objects', () => {
    const sink = capture();
    const logger = createLogger({ destination: sink.stream });
    logger.info(
      { a: { password: 'p1', b: { token: 't1', apiKey: 'k1' } }, ownerName: 'o1', email: 'e1' },
      'nested',
    );
    const raw = sink.raw();
    for (const secret of ['p1', 't1', 'k1', 'o1', 'e1']) expect(raw).not.toContain(`"${secret}"`);
  });

  it('logs unhandled errors at ERROR with the stack, but keeps it out of the response', async () => {
    const sink = capture();
    app = buildApp({ log: { destination: sink.stream } });
    app.get('/boom', () => {
      throw new Error('secret db message');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    const errorLine = sink.lines().find((l) => l['severity'] === 'ERROR');
    expect(errorLine).toBeDefined();
    expect(JSON.stringify(errorLine?.['err'])).toContain('secret db message');
    expect((errorLine?.['err'] as { stack: string }).stack).toContain('Error: secret db message');
    expect(errorLine?.['requestId']).toBe(res.headers['x-request-id']);
    expect(res.body).not.toContain('secret db message');
    // INFO access log has no stack
    const info = sink.lines().filter((l) => l['severity'] === 'INFO');
    expect(JSON.stringify(info)).not.toContain('stack');
  });
});

describe('logging overhead', () => {
  const median = (xs: number[]): number =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

  async function medianMs(instance: FastifyInstance, n: number): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = process.hrtime.bigint();
      await instance.inject({ method: 'GET', url: '/internal/healthz' });
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return median(samples);
  }

  it('adds less than 1 ms median per request', async () => {
    const devNull = new Writable({ write: (_c, _e, cb) => cb() });
    const quiet = buildApp(); // silent logger, same hooks
    const logging = buildApp({ log: { destination: devNull } });
    await quiet.ready();
    await logging.ready();
    await medianMs(quiet, 200); // warm-up
    await medianMs(logging, 200);
    // best of three rounds keeps the check robust against scheduler noise
    let best = Infinity;
    for (let round = 0; round < 3; round++) {
      const base = await medianMs(quiet, 500);
      const withLog = await medianMs(logging, 500);
      best = Math.min(best, withLog - base);
    }
    await quiet.close();
    await logging.close();
    expect(best).toBeLessThan(1);
  }, 30_000);
});
