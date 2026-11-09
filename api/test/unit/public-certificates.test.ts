import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { findForbiddenFields } from '../../src/http/dto/guard.js';
import { openApiDocument } from '../../src/http/openapi/plugin.js';
import { FakeCertificateRepository } from '../../src/testing/fakes/fake-certificate-repository.js';
import { createFakes } from '../../src/testing/fakes/index.js';
import type { Certificate } from '../../src/shared/domain.js';
import {
  asCertificateId,
  asEventId,
  asOrganizationId,
  asTemplateRef,
} from '../../src/shared/ids.js';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const LEGACY_ID = '0123456789abcdef0123456789abcdef';
const PUBLIC_KEYS = [
  'eventName',
  'id',
  'issuedAt',
  'organizationName',
  'ownerName',
  'pdfUrl',
  'skills',
  'status',
  'subject',
  'type',
];
const FORBIDDEN = [
  'email',
  'pdfPath',
  'createdBy',
  'emailStatus',
  'revokeReason',
  'templateId',
  'revokedAt',
];

interface PublicBody {
  status: string;
  pdfUrl: string | null;
  ownerName: string;
}
interface ErrBody {
  error: { code: string; message: string; requestId: string };
}

/** Counts reads of the underlying repository. */
class CountingRepository extends FakeCertificateRepository {
  reads = 0;
  override getById(...args: Parameters<FakeCertificateRepository['getById']>) {
    this.reads += 1;
    return super.getById(...args);
  }
}

const cert = (id: string, over: Partial<Certificate> = {}): Certificate =>
  ({
    id: asCertificateId(id),
    organizationId: asOrganizationId('org1'),
    eventId: asEventId('ev1'),
    organizationName: 'Org',
    eventName: 'Event',
    templateId: asTemplateRef('t-v1'),
    type: 'attendance',
    status: 'active',
    ownerName: 'Aysel Mammadova',
    email: 'aysel@example.test',
    subject: 'Subject',
    skills: ['a', 'b'],
    issuedAt: new Date(Date.UTC(2026, 0, 2)),
    emailStatus: 'sent',
    emailAttempts: 1,
    createdBy: 'admin-1',
    ...over,
  }) as Certificate;

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
});

async function setup(...certs: Certificate[]) {
  const repo = new CountingRepository();
  for (const c of certs) await repo.create(c);
  app = buildApp({
    ports: { ...createFakes(), certificates: repo },
    publicUrls: { publicBaseUrl: 'https://app.test/', pdfPublicBaseUrl: 'https://pdf.test' },
  });
  return repo;
}
const get = (id: string) =>
  app!.inject({ method: 'GET', url: `/api/v1/public/certificates/${id}` });

describe('GET /api/v1/public/certificates/{id}', () => {
  it('active without PDF points to the on-demand endpoint', async () => {
    await setup(cert(ID));
    const res = await get(ID);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: ID,
      ownerName: 'Aysel Mammadova',
      organizationName: 'Org',
      eventName: 'Event',
      type: 'attendance',
      subject: 'Subject',
      skills: ['a', 'b'],
      issuedAt: '2026-01-02T00:00:00.000Z',
      status: 'active',
      pdfUrl: `https://app.test/api/v1/public/certificates/${ID}/pdf`,
    });
  });

  it('active with PDF returns the direct URL', async () => {
    await setup(cert(ID, { pdfPath: 'tok123.pdf' }));
    expect((await get(ID)).json<PublicBody>().pdfUrl).toBe('https://pdf.test/pdfs/tok123.pdf');
  });

  it('revoked keeps the public fields, has no pdfUrl and leaks no revocation data', async () => {
    await setup(
      cert(ID, {
        status: 'revoked',
        pdfPath: 'tok123.pdf',
        revokedAt: new Date(),
        revokeReason: 'secret reason',
      }),
    );
    const res = await get(ID);
    expect(res.statusCode).toBe(200);
    const body = res.json<PublicBody>();
    expect(body.status).toBe('revoked');
    expect(body.pdfUrl).toBeNull();
    expect(body.ownerName).toBe('Aysel Mammadova');
    expect(res.body).not.toContain('secret reason');
  });

  it('serves a legacy 32-hex ID', async () => {
    await setup(cert(LEGACY_ID));
    expect((await get(LEGACY_ID)).statusCode).toBe(200);
  });

  it('sends the cache, robots and content-type headers', async () => {
    await setup(cert(ID));
    const res = await get(ID);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('exposes exactly the whitelisted keys and none of the forbidden ones', async () => {
    await setup(cert(ID, { pdfPath: 'p.pdf', revokeReason: 'r', revokedAt: new Date() }));
    const body = (await get(ID)).json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
    for (const key of FORBIDDEN) expect(body).not.toHaveProperty(key);
  });

  it('reads once for a valid ID (found or unknown)', async () => {
    const repo = await setup(cert(ID));
    await get(ID);
    expect(repo.reads).toBe(1);
    await get('Zz'.repeat(11));
    expect(repo.reads).toBe(2);
  });

  describe('not found', () => {
    const malformed: [string, string][] = [
      ['empty', ''],
      ['21 chars', 'a'.repeat(21)],
      ['23 chars', 'a'.repeat(23)],
      ['path traversal', '..%2F..%2Fetc%2Fpasswd'],
      ['nested path', 'abc/def'],
      ['dots', '....'],
      ['sql-ish', encodeURIComponent("' OR 1=1 --")],
      ['1 KB', 'a'.repeat(1024)],
      ['uppercase hex 32', 'A'.repeat(32)],
    ];

    it.each(malformed)(
      'malformed (%s) answers like an unknown ID without reading',
      async (_n, id) => {
        const repo = await setup(cert(ID));
        const unknown = await get('Zz'.repeat(11));
        expect(unknown.statusCode).toBe(404);
        const readsAfterUnknown = repo.reads;
        const res = await get(id);
        expect(repo.reads).toBe(readsAfterUnknown);
        expect(res.statusCode).toBe(404);
        const strip = (b: ErrBody) => ({ ...b.error, requestId: '' });
        expect(strip(res.json<ErrBody>())).toEqual(strip(unknown.json<ErrBody>()));
        expect(res.json<ErrBody>().error.code).toBe('NOT_FOUND');
        expect(res.headers['content-type']).toContain('application/json');
      },
    );
  });
});

describe('OpenAPI', () => {
  it('documents the route and contains no forbidden property', async () => {
    app = buildApp({ ports: createFakes() });
    await app.ready();
    const doc = openApiDocument(app);
    expect(Object.keys(doc.paths ?? {})).toContain('/api/v1/public/certificates/{id}');
    const schema = JSON.stringify(doc.components?.schemas?.['PublicCertificate']);
    for (const key of FORBIDDEN) expect(schema).not.toContain(`"${key}"`);
    // Admin schemas legitimately carry the administrator's own e-mail; scan the public operation only.
    expect(findForbiddenFields(doc.paths?.['/api/v1/public/certificates/{id}'])).toEqual([]);
    expect(findForbiddenFields(doc.components?.schemas?.['PublicCertificate'])).toEqual([]);
  });
});
