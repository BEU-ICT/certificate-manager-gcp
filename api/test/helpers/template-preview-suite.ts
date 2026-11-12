// Routes with a happy-path test in this file (checked by test/unit/authz-matrix.test.ts):
// happy-path: POST /api/v1/admin/templates/:reference/preview
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import jsQRModule from 'jsqr';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { TemplateConfig } from '../../src/modules/templates/index.js';
import { buildServices } from '../../src/services.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';
import { extractText, rasterize } from './pdf-inspect.js';

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`../fixtures/templates/good/${name}`, import.meta.url));

const jsQR = jsQRModule as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

const BASE = 'https://certs.example.test';
const GOOD_CONFIG = JSON.parse(fixture('config.json').toString('utf8')) as Record<string, unknown>;
const FILES = [
  { path: 'background.svg', body: fixture('background.svg') },
  { path: 'fonts/main.ttf', body: fixture('fonts/main.ttf') },
  { path: 'assets/logo.png', body: fixture('assets/logo.png') },
];

/**
 * Behaviour of `POST /api/v1/admin/templates/{reference}/preview` with the real `svg-pdf` engine,
 * run against in-memory fakes (unit) and the Firestore adapters on the emulator (integration);
 * the storage is always in memory so that writes can be observed.
 */
export function describeTemplatePreviewApi(
  name: string,
  makePorts: () => Promise<Fakes> | Fakes,
): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });
  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };

  async function setup(adminRateLimitPerMin?: number) {
    const fakes = await makePorts();
    const services = buildServices(fakes, undefined, { publicBaseUrl: `${BASE}/` });
    app = buildApp({
      ports: fakes,
      services,
      log: { level: 'silent' },
      publicUrls: { publicBaseUrl: `${BASE}/`, pdfPublicBaseUrl: 'https://pdf.example.test' },
      ...(adminRateLimitPerMin !== undefined && { adminRateLimitPerMin }),
    });
    const org = await services.organizations.create({ name: 'Acme', slug: 'acme' });
    const event = await services.events.create({
      organizationId: org.id,
      name: 'DevFest',
      slug: 'devfest',
    });
    const publish = (
      config: Record<string, unknown>,
      type: 'attendance' | 'thanks' = 'attendance',
    ) =>
      services.templates.publish({
        organizationId: org.id,
        eventId: event.id,
        organizationSlug: 'acme',
        eventSlug: 'devfest',
        type,
        config: config as unknown as TemplateConfig,
        files: FILES,
        createdBy: 'admin-0',
      });
    const template = await publish(GOOD_CONFIG);
    const storage = fakes.storage as unknown as { objects: Map<string, unknown> };
    const preview = (body?: unknown, reference: string = template.reference, headers = admin) =>
      app!.inject({
        method: 'POST',
        url: `/api/v1/admin/templates/${reference}/preview`,
        headers,
        ...(body !== undefined && { payload: body as object }),
      });
    const snapshot = async () => ({
      keys: [...storage.objects.keys()].sort(),
      templates: (await services.templates.listWithLatest({}, {})).items.length,
      certificates: await fakes.certificates.countByOrganization(org.id),
    });
    return { services, template, publish, preview, snapshot };
  }

  describe(`template preview API: ${name}`, () => {
    it('renders the typical preset by default: valid PDF, inline, no-store, nothing stored', async () => {
      const { preview, template, snapshot } = await setup();
      const before = await snapshot();
      const res = await preview();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `inline; filename="preview-${template.reference}.pdf"`,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      const pdf = res.rawPayload;
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      const text = await extractText(pdf);
      expect(text).toContain('Event participation');
      expect(await snapshot()).toEqual(before);
    });

    it('accepts an explicit empty object and the typical preset', async () => {
      const { preview } = await setup();
      expect((await preview({})).statusCode).toBe(200);
      expect((await preview({ preset: 'typical' })).statusCode).toBe(200);
    });

    it('encodes <PUBLIC_BASE_URL>/c/PREVIEW000000000000000 in the QR code', async () => {
      const { preview } = await setup();
      const raster = await rasterize((await preview()).rawPayload, 3);
      expect(jsQR(raster.data, raster.width, raster.height)?.data).toBe(
        `${BASE}/c/PREVIEW000000000000000`,
      );
    }, 30_000);

    it('applies provided fields over the preset and stores nothing', async () => {
      const { preview, snapshot } = await setup();
      const before = await snapshot();
      const res = await preview({
        ownerName: '  Test   Person ',
        subject: 'Custom subject',
        issuedAt: '2020-05-01T10:00:00Z',
        skills: ['One', 'one', 'Two'],
      });
      expect(res.statusCode).toBe(200);
      const text = await extractText(res.rawPayload);
      expect(text).toContain('Test Person');
      expect(text).toContain('Custom subject');
      expect(text).not.toContain('Event participation');
      expect(await snapshot()).toEqual(before);
    });

    it('overrides win over the longest preset', async () => {
      const { preview } = await setup();
      const res = await preview({ preset: 'longest', ownerName: 'Short Name', subject: 'Short' });
      expect(res.statusCode).toBe(200);
      expect(await extractText(res.rawPayload)).toContain('Short Name');
    });

    it('answers 422 TEXT_DOES_NOT_FIT with details for the longest preset on the fixture', async () => {
      const { preview, snapshot } = await setup();
      const before = await snapshot();
      const res = await preview({ preset: 'longest' });
      expect(res.statusCode).toBe(422);
      expect(res.headers['cache-control']).toBe('no-store');
      const error = res.json().error;
      expect(error.code).toBe('TEXT_DOES_NOT_FIT');
      expect(error.details.length).toBeGreaterThan(0);
      for (const detail of error.details) {
        expect(Object.keys(detail).sort()).toEqual(['message', 'path']);
      }
      expect(error.details.map((d: { path: string }) => d.path)).toContain('ownerName');
      expect(await snapshot()).toEqual(before);
    });

    it('answers 422 QR_TOO_SMALL when the template QR code is too small', async () => {
      const { publish, preview } = await setup();
      const tiny = await publish({ ...GOOD_CONFIG, qr: { x: 700, y: 450, size: 40 } }, 'thanks');
      const res = await preview({}, tiny.reference);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('QR_TOO_SMALL');
      expect(res.json().error.details[0].path).toBe('qr');
    });

    it('answers 404 for unknown and malformed references', async () => {
      const { preview } = await setup();
      for (const reference of ['acme-devfest-attendance-v9', 'NOT%20A%20REF']) {
        const res = await preview({}, reference);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('NOT_FOUND');
      }
    });

    it('rejects unknown properties and values beyond the certificate limits with 400', async () => {
      const { preview } = await setup();
      const bad: unknown[] = [
        { email: 'a@b.co' },
        { preset: 'huge' },
        { ownerName: 'x'.repeat(121) },
        { subject: '' },
        { skills: Array.from({ length: 11 }, (_, i) => `s${String(i)}`) },
        { skills: ['y'.repeat(41)] },
        { issuedAt: 'tomorrow' },
      ];
      for (const body of bad) {
        const res = await preview(body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('answers 401 without a token and 403 for non-admins', async () => {
      const { preview, template } = await setup();
      expect((await preview({}, template.reference, {} as typeof admin)).statusCode).toBe(401);
      const user = { authorization: `Bearer ${fakeToken('u1')}` };
      expect((await preview({}, template.reference, user)).statusCode).toBe(403);
      expect((await preview({}, template.reference, admin)).statusCode).toBe(200);
    });

    it('counts toward the admin rate limit', async () => {
      const { preview } = await setup(2);
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await preview({})).statusCode);
      expect(statuses).toEqual([200, 200, 429]);
    });
  });
}
