import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createFeatureFlags, parseFlags } from '../../src/flags.js';
import { openApiDocument } from '../../src/http/openapi/plugin.js';
import { DefaultPublicPdfService, type PublicPdfLogger } from '../../src/modules/pdf/index.js';
import { buildServices } from '../../src/services.js';
import { FakeCertificateRepository } from '../../src/testing/fakes/fake-certificate-repository.js';
import { createFakes } from '../../src/testing/fakes/index.js';
import type { Certificate, Template } from '../../src/shared/domain.js';
import { UnavailableError } from '../../src/shared/errors.js';
import {
  asCertificateId,
  asEventId,
  asOrganizationId,
  asTemplateRef,
} from '../../src/shared/ids.js';
import type { Services } from '../../src/wiring.js';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const REF = 'acme-devfest-attendance-v0';
const URLS = { publicBaseUrl: 'https://app.test', pdfPublicBaseUrl: 'https://pdf.test/' };
const PDF_BYTES = Buffer.from('%PDF-1.7 stub');

const cert = (over: Partial<Certificate> = {}): Certificate => ({
  id: asCertificateId(ID),
  organizationId: asOrganizationId('org1'),
  eventId: asEventId('ev1'),
  organizationName: 'Org',
  eventName: 'Event',
  templateId: asTemplateRef(REF),
  type: 'attendance',
  status: 'active',
  ownerName: 'Aysel Mammadova',
  email: 'aysel@example.test',
  subject: 'Subject',
  skills: ['a'],
  issuedAt: new Date(Date.UTC(2026, 0, 2)),
  emailStatus: 'sent',
  emailAttempts: 1,
  createdBy: 'admin-1',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  schemaVersion: 1,
  ...over,
});

const template = (): Template => ({
  reference: asTemplateRef(REF),
  organizationId: asOrganizationId('org1'),
  eventId: asEventId('ev1'),
  organizationSlug: 'acme',
  eventSlug: 'devfest',
  type: 'attendance',
  version: 0,
  storagePath: `templates/${REF}/`,
  config: {},
  createdAt: new Date(0),
  createdBy: 'admin',
  schemaVersion: 1,
});

/** Records renders; `beforeReturn` runs after the render and before the caller continues. */
class StubPdf {
  renders = 0;
  beforeReturn: (() => Promise<void>) | undefined;
  failWith: Error | undefined;
  async render(): Promise<Buffer> {
    this.renders += 1;
    await Promise.resolve();
    if (this.failWith) throw this.failWith;
    await this.beforeReturn?.();
    return PDF_BYTES;
  }
}

class RecordingLogger implements PublicPdfLogger {
  readonly lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  info(obj: Record<string, unknown>, msg: string) {
    this.lines.push({ level: 'info', obj, msg });
  }
  warn(obj: Record<string, unknown>, msg: string) {
    this.lines.push({ level: 'warn', obj, msg });
  }
  error(obj: Record<string, unknown>, msg: string) {
    this.lines.push({ level: 'error', obj, msg });
  }
}

class FailingSetRepository extends FakeCertificateRepository {
  fail = false;
  override setPdfPathIfAbsent(
    ...args: Parameters<FakeCertificateRepository['setPdfPathIfAbsent']>
  ) {
    if (this.fail) return Promise.reject(new Error('firestore down'));
    return super.setPdfPathIfAbsent(...args);
  }
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

interface Setup {
  fakes: ReturnType<typeof createFakes> & { certificates: FailingSetRepository };
  stub: StubPdf;
  logger: RecordingLogger;
  newService: () => DefaultPublicPdfService;
}

async function setup(withTemplate = true, ...certs: Certificate[]): Promise<Setup> {
  const fakes = { ...createFakes(), certificates: new FailingSetRepository() };
  for (const c of certs.length > 0 ? certs : [cert()]) await fakes.certificates.create(c);
  if (withTemplate) await fakes.templates.create(template());
  const stub = new StubPdf();
  const logger = new RecordingLogger();
  const base = buildServices(fakes);
  const newService = () =>
    new DefaultPublicPdfService({
      certificates: fakes.certificates,
      templates: base.templates,
      pdf: stub,
      storage: fakes.storage,
      ids: fakes.ids,
      clock: fakes.clock,
      logger,
    });
  return { fakes, stub, logger, newService };
}

function start(s: Setup, flagEnv: Record<string, string> = {}, service = s.newService()) {
  const services: Services = { ...buildServices(s.fakes), publicPdf: service };
  app = buildApp({
    ports: s.fakes,
    services,
    publicUrls: URLS,
    flags: createFeatureFlags(parseFlags(flagEnv, false).flags),
  });
  return app;
}
const get = (id = ID) =>
  app!.inject({ method: 'GET', url: `/api/v1/public/certificates/${id}/pdf` });
const pdfObjects = (s: Setup) =>
  [...s.fakes.storage.objects.keys()].filter((k) => k.startsWith('pdfs:'));

describe('GET /api/v1/public/certificates/{id}/pdf', () => {
  it('first request renders, stores the object and the reference, then redirects', async () => {
    const s = await setup();
    start(s);
    const res = await get();
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('https://pdf.test/pdfs/token-1.pdf');
    expect(res.headers['cache-control']).toBe('no-store');
    const stored = s.fakes.storage.objects.get('pdfs:token-1.pdf');
    expect(stored?.body.equals(PDF_BYTES)).toBe(true);
    expect(stored?.options).toEqual({
      contentType: 'application/pdf',
      cacheControl: 'no-cache',
      contentDisposition: `inline; filename="certificate-${ID}.pdf"`,
    });
    const saved = await s.fakes.certificates.getById(asCertificateId(ID));
    expect(saved?.pdfPath).toBe('token-1.pdf');
    expect(saved?.pdfGeneratedAt).toBeInstanceOf(Date);
    const generated = s.logger.lines.filter((l) => l.msg === 'pdf_generated');
    expect(generated).toHaveLength(1);
    expect(Object.keys(generated[0]!.obj).sort()).toEqual([
      'bytes',
      'cache',
      'certId',
      'durationMs',
      'templateRef',
    ]);
  });

  it('second request redirects without rendering', async () => {
    const s = await setup();
    start(s);
    await get();
    expect(s.stub.renders).toBe(1);
    const res = await get();
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('https://pdf.test/pdfs/token-1.pdf');
    expect(s.stub.renders).toBe(1);
    expect(pdfObjects(s)).toHaveLength(1);
  });

  it('20 concurrent first requests share one render and one object', async () => {
    const s = await setup();
    start(s);
    const responses = await Promise.all(Array.from({ length: 20 }, () => get()));
    expect(new Set(responses.map((r) => r.statusCode))).toEqual(new Set([302]));
    expect(new Set(responses.map((r) => r.headers['location'])).size).toBe(1);
    expect(s.stub.renders).toBe(1);
    expect(pdfObjects(s)).toHaveLength(1);
  });

  it('two instances racing: setPdfPathIfAbsent arbitrates, the loser deletes its object', async () => {
    const s = await setup();
    const a = s.newService();
    const b = s.newService();
    // Both render before either stores its reference.
    let arrived = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.stub.beforeReturn = async () => {
      arrived += 1;
      if (arrived === 2) release();
      await gate;
    };
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => a.ensurePdf(ID)),
      ...Array.from({ length: 10 }, () => b.ensurePdf(ID)),
    ]);
    expect(s.stub.renders).toBe(2);
    expect(new Set(results.map((r) => r.pdfPath)).size).toBe(1);
    expect(pdfObjects(s)).toEqual([`pdfs:${results[0]!.pdfPath}`]);
    expect(results.filter((r) => r.source === 'raced')).not.toHaveLength(0);
  });

  it('revoked certificate: 410 and no object', async () => {
    const s = await setup(true, cert({ status: 'revoked' }));
    start(s);
    const res = await get();
    expect(res.statusCode).toBe(410);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('GONE');
    expect(s.stub.renders).toBe(0);
    expect(pdfObjects(s)).toHaveLength(0);
  });

  it('revoked during generation: 410 and no object left', async () => {
    const s = await setup();
    start(s);
    s.stub.beforeReturn = async () => {
      await s.fakes.certificates.markRevoked(asCertificateId(ID), {
        reason: 'r',
        at: new Date(),
      });
    };
    const res = await get();
    expect(res.statusCode).toBe(410);
    expect(pdfObjects(s)).toHaveLength(0);
    expect((await s.fakes.certificates.getById(asCertificateId(ID)))?.pdfPath).toBeUndefined();
  });

  it('storage outage: 503 with Retry-After 5 and no reference', async () => {
    const s = await setup();
    start(s);
    s.stub.beforeReturn = () => {
      s.fakes.storage.setAvailable(false);
      return Promise.resolve();
    };
    const res = await get();
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect((await s.fakes.certificates.getById(asCertificateId(ID)))?.pdfPath).toBeUndefined();
    s.fakes.storage.setAvailable(true);
    expect(pdfObjects(s)).toHaveLength(0);
  });

  it('database failure after upload: object deleted, 503', async () => {
    const s = await setup();
    start(s);
    s.fakes.certificates.fail = true;
    const res = await get();
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(pdfObjects(s)).toHaveLength(0);
  });

  it('keeps failing quietly when the surplus object cannot be deleted', async () => {
    const s = await setup();
    s.fakes.certificates.fail = true;
    const service = s.newService();
    s.fakes.storage.delete = () => Promise.reject(new UnavailableError());
    await expect(service.ensurePdf(ID)).rejects.toBeInstanceOf(UnavailableError);
    expect(s.logger.lines.some((l) => l.level === 'warn')).toBe(true);
  });

  it('unknown and malformed IDs answer an identical 404', async () => {
    const s = await setup();
    start(s);
    const unknown = await get('ZzCdEfGhIjKlMnOpQrStUv');
    const malformed = await get('not-an-id');
    expect(unknown.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
    const strip = (r: typeof unknown) => ({
      ...r.json<{ error: Record<string, unknown> }>().error,
      requestId: undefined,
    });
    expect(strip(malformed)).toEqual(strip(unknown));
    expect(s.stub.renders).toBe(0);
  });

  it('kill switch off: 503 for ungenerated, redirect for existing', async () => {
    const s = await setup(
      true,
      cert(),
      cert({ id: asCertificateId('BbCdEfGhIjKlMnOpQrStUv'), pdfPath: 'old.pdf' }),
    );
    start(s, { FEATURE_PUBLIC_PDF_GENERATION: 'false' });
    const off = await get();
    expect(off.statusCode).toBe(503);
    expect(s.stub.renders).toBe(0);
    const existing = await get('BbCdEfGhIjKlMnOpQrStUv');
    expect(existing.statusCode).toBe(302);
    expect(existing.headers['location']).toBe('https://pdf.test/pdfs/old.pdf');
  });

  it('missing template: 500 INTERNAL with an ERROR log naming certificate and template', async () => {
    const s = await setup(false);
    start(s);
    const res = await get();
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL');
    const logged = s.logger.lines.find((l) => l.level === 'error');
    expect(logged?.obj).toMatchObject({ certId: ID, templateRef: REF });
    expect(JSON.stringify(s.logger.lines)).not.toContain('Aysel');
    expect(pdfObjects(s)).toHaveLength(0);
  });

  it('render failure: 500 with ERROR log; render capacity errors stay 503', async () => {
    const s = await setup();
    start(s);
    s.stub.failWith = new Error('boom');
    expect((await get()).statusCode).toBe(500);
    expect(s.logger.lines.some((l) => l.level === 'error' && l.obj['certId'] === ID)).toBe(true);
    s.stub.failWith = new UnavailableError(5, 'busy');
    const busy = await get();
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBe('5');
  });

  it('single-flight leaves no entry behind after a failure; a retry succeeds', async () => {
    const s = await setup();
    const service = s.newService();
    s.stub.failWith = new Error('boom');
    await expect(service.ensurePdf(ID)).rejects.toThrow();
    s.stub.failWith = undefined;
    await expect(service.ensurePdf(ID)).resolves.toMatchObject({ source: 'generated' });
    expect(s.stub.renders).toBe(2);
  });

  it('is documented in the OpenAPI document', async () => {
    const s = await setup();
    start(s);
    await app!.ready();
    const doc = openApiDocument(app!) as {
      paths: Record<string, { get?: { operationId?: string; responses: Record<string, unknown> } }>;
    };
    const op = doc.paths['/api/v1/public/certificates/{id}/pdf']?.get;
    expect(op?.operationId).toBe('getPublicCertificatePdf');
    expect(Object.keys(op?.responses ?? {})).toEqual(
      expect.arrayContaining(['302', '404', '410', '500', '503']),
    );
  });
});
