/* eslint-disable @typescript-eslint/no-unsafe-member-access -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreCertificateRepository } from '../../src/adapters/firestore/certificate-repository.js';
import { FirestoreEventRepository } from '../../src/adapters/firestore/event-repository.js';
import { FirestoreIdempotencyStore } from '../../src/adapters/firestore/idempotency-store.js';
import { FirestoreOrganizationRepository } from '../../src/adapters/firestore/organization-repository.js';
import { FirestoreTemplateRepository } from '../../src/adapters/firestore/template-repository.js';
import { buildApp } from '../../src/app.js';
import { createFeatureFlags, parseFlags } from '../../src/flags.js';
import type { FitChecker } from '../../src/modules/certificates/index.js';
import { DefaultPublicPdfService, type FitResult } from '../../src/modules/pdf/index.js';
import { buildServices } from '../../src/services.js';
import {
  sampleEvent,
  sampleOrganization,
  sampleTemplate,
} from '../../src/testing/contracts/index.js';
import { createFakes, fakeToken, type Fakes } from '../../src/testing/fakes/index.js';
import type { Certificate } from '../../src/shared/domain.js';
import type { Services } from '../../src/wiring.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

/**
 * End-to-end flow on the Firestore emulator with EVERY repository port (organizations, events,
 * templates, certificates, idempotency) backed by the real Firestore adapters. Only storage, the
 * PDF renderer and the fit checker are test doubles. Covers the acceptance items of
 * BEU-ICT/certificate-manager#337, #340, #350, #357 and #359 that need the emulator.
 */

class CountingCertificates extends FirestoreCertificateRepository {
  reads = 0;
  override getById(...args: Parameters<FirestoreCertificateRepository['getById']>) {
    this.reads += 1;
    return super.getById(...args);
  }
}

class StubFit implements FitChecker {
  failing = new Set<string>();
  /** Awaited before answering, to hold a request open. */
  gate: Promise<void> | undefined;
  async checkFit(certificate: Certificate): Promise<FitResult> {
    await this.gate;
    if (this.failing.has(certificate.ownerName)) {
      return {
        fits: false,
        issues: [{ field: 'ownerName', message: 'too long', reason: 'TEXT_DOES_NOT_FIT' }],
      };
    }
    return { fits: true, issues: [] };
  }
}

class StubPdf {
  renders = 0;
  render(): Promise<Buffer> {
    this.renders += 1;
    return Promise.resolve(Buffer.from('%PDF-1.7 stub'));
  }
}

const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
const PDF_BASE = 'https://pdf.test';
const FORBIDDEN = ['email', 'pdfPath', 'createdBy', 'emailStatus', 'revokeReason', 'templateId'];

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
beforeEach(resetFirestore);

async function setup() {
  const db = getTestFirestore();
  const fakes = createFakes();
  const certificates = new CountingCertificates(db);
  const ports: Fakes = {
    ...fakes,
    organizations: new FirestoreOrganizationRepository(db),
    events: new FirestoreEventRepository(db),
    templates: new FirestoreTemplateRepository(db),
    certificates,
    idempotency: new FirestoreIdempotencyStore(db, fakes.clock),
  } as unknown as Fakes;
  const org = sampleOrganization({ name: 'Acme Org' });
  const event = sampleEvent({ organizationId: org.id, name: 'DevFest' });
  await ports.organizations.create(org);
  await ports.events.create(event);
  const template = sampleTemplate({ organizationId: org.id, eventId: event.id, version: 1 });
  await ports.templates.create(template);

  const fit = new StubFit();
  const pdf = new StubPdf();
  const base = buildServices(ports, undefined, { fitChecker: fit });
  const newPublicPdf = () =>
    new DefaultPublicPdfService({
      certificates,
      templates: base.templates,
      pdf,
      storage: ports.storage,
      ids: ports.ids,
      clock: ports.clock,
    });
  const services: Services = { ...base, publicPdf: newPublicPdf() };
  app = buildApp({
    ports,
    services,
    adminRateLimitPerMin: 100_000,
    publicUrls: { publicBaseUrl: 'https://app.test', pdfPublicBaseUrl: PDF_BASE },
    flags: createFeatureFlags(parseFlags({ FEATURE_BULK_ISSUANCE: 'true' }, true).flags),
  });
  const body = (over: Record<string, unknown> = {}) => ({
    organizationId: org.id,
    eventId: event.id,
    type: 'attendance',
    ownerName: 'Aysel Məmmədova',
    subject: 'Cloud workshop',
    ...over,
  });
  const post = (payload: unknown, headers: Record<string, string> = admin) =>
    app!.inject({
      method: 'POST',
      url: '/api/v1/admin/certificates',
      headers,
      payload: payload as object,
    });
  const bulk = (items: unknown[], headers: Record<string, string> = admin) =>
    app!.inject({
      method: 'POST',
      url: '/api/v1/admin/certificates/bulk',
      headers,
      payload: {
        organizationId: org.id,
        eventId: event.id,
        type: 'attendance',
        subject: 'Cloud workshop',
        items,
      },
    });
  const revoke = (id: string, reason = 'Issued by mistake') =>
    app!.inject({
      method: 'POST',
      url: `/api/v1/admin/certificates/${id}/revoke`,
      headers: admin,
      payload: { reason },
    });
  const details = (id: string) =>
    app!.inject({ method: 'GET', url: `/api/v1/public/certificates/${id}` });
  const pdfOf = (id: string) =>
    app!.inject({ method: 'GET', url: `/api/v1/public/certificates/${id}/pdf` });
  const pdfObjects = () => [...ports.storage.objects.keys()].filter((k) => k.startsWith('pdfs:'));
  return {
    ports,
    certificates,
    fit,
    pdf,
    org,
    event,
    template,
    body,
    post,
    bulk,
    revoke,
    details,
    pdfOf,
    pdfObjects,
    newPublicPdf,
    services,
  };
}

const people = (n: number) =>
  Array.from({ length: n }, (_v, i) => ({
    ownerName: `Person ${String(i)}`,
    ...(i % 2 === 0 && { email: `p${String(i)}@example.com` }),
  }));

describe('single issuance on Firestore', () => {
  it('201 stores the document with snapshots and email status', async () => {
    const s = await setup();
    const withMail = await s.post(s.body({ email: 'a@example.com' }));
    const without = await s.post(s.body());
    expect(withMail.statusCode).toBe(201);
    expect(withMail.json()).toMatchObject({
      status: 'active',
      emailStatus: 'pending',
      organizationName: 'Acme Org',
      eventName: 'DevFest',
      templateId: s.template.reference,
    });
    expect(without.json()).toMatchObject({ emailStatus: 'skipped', email: null });
    const stored = await s.ports.certificates.getById(withMail.json().id as never);
    expect(stored?.email).toBe('a@example.com');
    expect(await s.ports.certificates.count({})).toBe(2);
  });

  it('422 TEXT_DOES_NOT_FIT creates no document', async () => {
    const s = await setup();
    s.fit.failing.add('Too Long Name');
    const res = await s.post(s.body({ ownerName: 'Too Long Name' }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('TEXT_DOES_NOT_FIT');
    expect(await s.ports.certificates.count({})).toBe(0);
  });

  it('Idempotency-Key replay returns the stored response and creates one document', async () => {
    const s = await setup();
    const headers = { ...admin, 'idempotency-key': 'key-1' };
    const first = await s.post(s.body(), headers);
    const second = await s.post(s.body(), headers);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(await s.ports.certificates.count({})).toBe(1);
    const other = await s.post(s.body({ ownerName: 'Someone Else' }), headers);
    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a concurrent duplicate with the same key gets 409 REQUEST_IN_PROGRESS', async () => {
    const s = await setup();
    let release!: () => void;
    s.fit.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const headers = { ...admin, 'idempotency-key': 'key-2' };
    const firstRequest = s.post(s.body(), headers);
    // Let the first request claim the key (a Firestore transaction) before the duplicate arrives.
    await new Promise((r) => setTimeout(r, 500));
    const duplicate = await s.post(s.body(), headers);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('REQUEST_IN_PROGRESS');
    release();
    const first = await firstRequest;
    expect(first.statusCode).toBe(201);
    expect(await s.ports.certificates.count({})).toBe(1);
    const replay = await s.post(s.body(), headers);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json().id).toBe(first.json().id);
  });
});

describe('bulk issuance on Firestore', () => {
  it('500 valid items create 500 documents in one request, in order', async () => {
    const s = await setup();
    const res = await s.bulk(people(500));
    expect(res.statusCode).toBe(201);
    expect(res.json().created).toBe(500);
    expect((res.json().items as { ownerName: string }[]).map((i) => i.ownerName)).toEqual(
      people(500).map((p) => p.ownerName),
    );
    expect(JSON.stringify(res.json())).not.toContain('example.com');
    expect(await s.ports.certificates.count({})).toBe(500);
    const emailStatuses = await s.ports.certificates.count({ emailStatus: 'pending' });
    expect(emailStatuses).toBe(250);
  });

  it('501 items: 400, nothing written', async () => {
    const s = await setup();
    const res = await s.bulk(people(501));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(await s.ports.certificates.count({})).toBe(0);
  });

  it('one invalid item among 500: 422 BULK_INVALID naming it and zero documents', async () => {
    const s = await setup();
    s.fit.failing.add('Person 17');
    const res = await s.bulk(people(500));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('BULK_INVALID');
    const paths = (res.json().error.details as { path: string }[]).map((d) => d.path);
    expect(paths.some((p: string) => p.startsWith('items[17]'))).toBe(true);
    expect(await s.ports.certificates.count({})).toBe(0);
  });

  it('caps the error list at 200 and flags truncated', async () => {
    const s = await setup();
    const items = people(300);
    for (const p of items) s.fit.failing.add(p.ownerName);
    const res = await s.bulk(items);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('BULK_INVALID');
    expect(res.json().error.details).toHaveLength(200);
    expect(JSON.stringify(res.json().error)).toContain('"truncated":true');
    expect(await s.ports.certificates.count({})).toBe(0);
  });

  it('idempotent replay creates the certificates once', async () => {
    const s = await setup();
    const headers = { ...admin, 'idempotency-key': 'bulk-1' };
    const first = await s.bulk(people(20), headers);
    const second = await s.bulk(people(20), headers);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(await s.ports.certificates.count({})).toBe(20);
  });
});

describe('public details, PDF and revocation on Firestore', () => {
  it('details: active without PDF, forbidden keys absent, exactly one read', async () => {
    const s = await setup();
    const id = (await s.post(s.body({ email: 'a@example.com' }))).json().id as string;
    s.certificates.reads = 0;
    const res = await s.details(id);
    expect(res.statusCode).toBe(200);
    expect(s.certificates.reads).toBe(1);
    expect(res.json()).toMatchObject({
      id,
      status: 'active',
      organizationName: 'Acme Org',
      pdfUrl: `https://app.test/api/v1/public/certificates/${id}/pdf`,
    });
    for (const key of FORBIDDEN) expect(res.json()).not.toHaveProperty(key);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('malformed IDs answer an identical 404 with zero reads; unknown ID costs one read', async () => {
    const s = await setup();
    const malformed = [
      '',
      'x'.repeat(21),
      'x'.repeat(23),
      '..%2F..%2Fetc',
      "a'%20OR%201=1",
      'y'.repeat(1024),
    ];
    const unknown = await s.details('AbCdEfGhIjKlMnOpQrStUv');
    s.certificates.reads = 0;
    for (const id of malformed) {
      const res = await s.details(id);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe(unknown.json().error.code);
    }
    expect(s.certificates.reads).toBe(0);
    await s.details('AbCdEfGhIjKlMnOpQrStUv');
    expect(s.certificates.reads).toBe(1);
  });

  it('pdf: first request generates, stores pdfPath and redirects; second does not render', async () => {
    const s = await setup();
    const id = (await s.post(s.body())).json().id as string;
    const first = await s.pdfOf(id);
    expect(first.statusCode).toBe(302);
    expect(first.headers['cache-control']).toBe('no-store');
    const location = first.headers.location as string;
    expect(location).toMatch(new RegExp(`^${PDF_BASE}/pdfs/.+\\.pdf$`));
    expect(s.pdf.renders).toBe(1);
    expect(s.pdfObjects()).toHaveLength(1);
    const stored = await s.ports.certificates.getById(id as never);
    expect(stored?.pdfPath).toBe(location.replace(`${PDF_BASE}/pdfs/`, ''));
    expect(stored?.pdfGeneratedAt).toBeInstanceOf(Date);
    const second = await s.pdfOf(id);
    expect(second.statusCode).toBe(302);
    expect(second.headers.location).toBe(location);
    expect(s.pdf.renders).toBe(1);
    const dto = await s.details(id);
    expect(dto.json().pdfUrl).toBe(location);
  });

  it('20 concurrent first requests leave exactly one object and one redirect target', async () => {
    const s = await setup();
    const id = (await s.post(s.body())).json().id as string;
    const results = await Promise.all(Array.from({ length: 20 }, () => s.pdfOf(id)));
    expect(new Set(results.map((r) => r.statusCode))).toEqual(new Set([302]));
    expect(new Set(results.map((r) => r.headers.location)).size).toBe(1);
    expect(s.pdfObjects()).toHaveLength(1);
  });

  it('two instances racing: the Firestore transaction arbitrates and the loser deletes its object', async () => {
    const s = await setup();
    const id = (await s.post(s.body())).json().id as string;
    const a = s.newPublicPdf();
    const b = s.newPublicPdf();
    const [ra, rb] = await Promise.all([a.ensurePdf(id), b.ensurePdf(id)]);
    expect(ra.pdfPath).toBe(rb.pdfPath);
    expect(s.pdfObjects()).toHaveLength(1);
  });

  it('unknown and malformed IDs: 404 on /pdf', async () => {
    const s = await setup();
    expect((await s.pdfOf('AbCdEfGhIjKlMnOpQrStUv')).statusCode).toBe(404);
    expect((await s.pdfOf('not-an-id')).statusCode).toBe(404);
    expect(s.pdfObjects()).toHaveLength(0);
  });

  it('storage outage: 503 with Retry-After and no pdfPath', async () => {
    const s = await setup();
    const id = (await s.post(s.body())).json().id as string;
    s.ports.storage.setAvailable(false);
    const res = await s.pdfOf(id);
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    s.ports.storage.setAvailable(true);
    expect((await s.ports.certificates.getById(id as never))?.pdfPath).toBeUndefined();
  });

  it('revoke with a generated PDF: object deleted, pdfPath cleared, public page revoked, /pdf 410', async () => {
    const s = await setup();
    const id = (await s.post(s.body({ email: 'a@example.com' }))).json().id as string;
    await s.pdfOf(id);
    expect(s.pdfObjects()).toHaveLength(1);
    const res = await s.revoke(id);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('revoked');
    expect(s.pdfObjects()).toHaveLength(0);
    const stored = await s.ports.certificates.getById(id as never);
    expect(stored).toMatchObject({ status: 'revoked', revokeReason: 'Issued by mistake' });
    expect(stored?.pdfPath ?? null).toBeNull();
    const page = await s.details(id);
    expect(page.statusCode).toBe(200);
    expect(page.json().status).toBe('revoked');
    expect(page.json().pdfUrl).toBeNull();
    expect(page.json().ownerName).toBe('Aysel Məmmədova');
    for (const key of [...FORBIDDEN, 'revokedAt']) expect(page.json()).not.toHaveProperty(key);
    const gone = await s.pdfOf(id);
    expect(gone.statusCode).toBe(410);
    expect(s.pdfObjects()).toHaveLength(0);
  });

  it('revoke is idempotent and keeps the first reason; unknown id is 404', async () => {
    const s = await setup();
    const id = (await s.post(s.body())).json().id as string;
    const first = await s.revoke(id, 'first');
    const second = await s.revoke(id, 'second');
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect((await s.ports.certificates.getById(id as never))?.revokeReason).toBe('first');
    expect((await s.revoke('AbCdEfGhIjKlMnOpQrStUv')).statusCode).toBe(404);
    expect((await s.revoke(id, '')).statusCode).toBe(400);
  });

  it('revoke deletion failure: 200 with warning, pdfPath kept, second call repairs', async () => {
    const s = await setup();
    const id = (await s.post(s.body())).json().id as string;
    await s.pdfOf(id);
    const realDelete = s.ports.storage.delete.bind(s.ports.storage);
    s.ports.storage.delete = () => Promise.reject(new Error('storage down'));
    const res = await s.revoke(id);
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toEqual(['PDF_DELETE_FAILED']);
    expect((await s.ports.certificates.getById(id as never))?.pdfPath).toBeTruthy();
    s.ports.storage.delete = realDelete;
    const repair = await s.revoke(id);
    expect(repair.statusCode).toBe(200);
    expect(s.pdfObjects()).toHaveLength(0);
    expect((await s.ports.certificates.getById(id as never))?.pdfPath ?? null).toBeNull();
  });

  it('revoke during PDF generation: 410 and no object left', async () => {
    const s = await setup();
    const id = (await s.post(s.body())).json().id as string;
    const realRender = s.pdf.render.bind(s.pdf);
    s.pdf.render = async () => {
      const buffer = await realRender();
      await s.ports.certificates.markRevoked(id as never, { reason: 'race', at: new Date() });
      return buffer;
    };
    const res = await s.pdfOf(id);
    expect(res.statusCode).toBe(410);
    expect(s.pdfObjects()).toHaveLength(0);
  });
});
