/* eslint-disable @typescript-eslint/no-unsafe-member-access -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildServices } from '../../src/services.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';
import type { Certificate } from '../../src/shared/domain.js';
import { asCertificateId } from '../../src/shared/ids.js';

/**
 * Behaviour of `POST /api/v1/admin/certificates/:id/revoke`, run against in-memory fakes (unit)
 * and the Firestore adapter on the emulator (integration).
 */
export function describeCertificateRevocationApi(
  name: string,
  makePorts: () => Promise<Fakes> | Fakes,
): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };

  async function setup(): Promise<{ app: FastifyInstance; fakes: Fakes }> {
    const fakes = await makePorts();
    app = buildApp({ ports: fakes, services: buildServices(fakes) });
    return { app, fakes };
  }
  const revoke = (id: string, payload: unknown = { reason: 'Issued by mistake' }) =>
    app!.inject({
      method: 'POST',
      url: `/api/v1/admin/certificates/${id}/revoke`,
      headers: admin,
      payload: payload as object,
    });
  const seed = async (fakes: Fakes, overrides: Partial<Certificate> = {}) => {
    const cert = sampleCertificate(overrides);
    await fakes.certificates.create(cert);
    return cert;
  };
  const putPdf = (fakes: Fakes, key: string) =>
    fakes.storage.put('pdfs', key, Buffer.from('%PDF'), { contentType: 'application/pdf' });

  describe(`certificate revocation API: ${name}`, () => {
    it('revokes an active certificate: status, reason, time, object deleted, pdfPath cleared, event published', async () => {
      const { fakes } = await setup();
      const cert = await seed(fakes, { pdfPath: 'tok1.pdf', pdfGeneratedAt: new Date() });
      await putPdf(fakes, 'tok1.pdf');
      const res = await revoke(cert.id, { reason: '  Wrong​   owner ' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toMatchObject({
        id: cert.id,
        status: 'revoked',
        revokeReason: 'Wrong owner',
        revokedAt: fakes.clock.now().toISOString(),
        hasPdf: false,
      });
      expect(res.json().warnings).toBeUndefined();
      expect(res.json()).not.toHaveProperty('pdfPath');
      expect(await fakes.storage.get('pdfs', 'tok1.pdf')).toBeNull();
      const stored = await fakes.certificates.getById(cert.id);
      expect(stored?.pdfPath).toBeUndefined();
      expect(fakes.eventBus.published).toEqual([
        {
          type: 'certificate.revoked',
          payload: { certificateId: cert.id, occurredAt: fakes.clock.now() },
        },
      ]);
    });

    it('revokes a certificate without a PDF', async () => {
      const { fakes } = await setup();
      const cert = await seed(fakes);
      const res = await revoke(cert.id);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'revoked', hasPdf: false });
      expect(res.json().warnings).toBeUndefined();
    });

    it('is idempotent: the repeat answers 200, keeps the first reason and time, publishes once', async () => {
      const { fakes } = await setup();
      const cert = await seed(fakes);
      const first = await revoke(cert.id, { reason: 'First' });
      fakes.clock.advance(60_000);
      const second = await revoke(cert.id, { reason: 'Second' });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      expect(second.json().revokeReason).toBe('First');
      expect(fakes.eventBus.published).toHaveLength(1);
    });

    it('answers 200 with a warning when the deletion fails, keeps pdfPath, and the next call repairs it', async () => {
      const { fakes } = await setup();
      const cert = await seed(fakes, { pdfPath: 'tok2.pdf', pdfGeneratedAt: new Date() });
      await putPdf(fakes, 'tok2.pdf');
      fakes.storage.setAvailable(false);
      const failed = await revoke(cert.id);
      expect(failed.statusCode).toBe(200);
      expect(failed.json()).toMatchObject({
        status: 'revoked',
        hasPdf: true,
        warnings: ['PDF_DELETE_FAILED'],
      });
      expect((await fakes.certificates.getById(cert.id))?.pdfPath).toBe('tok2.pdf');

      fakes.storage.setAvailable(true);
      const repaired = await revoke(cert.id, { reason: 'ignored' });
      expect(repaired.statusCode).toBe(200);
      expect(repaired.json()).toMatchObject({ revokeReason: 'Issued by mistake', hasPdf: false });
      expect(repaired.json().warnings).toBeUndefined();
      expect(await fakes.storage.get('pdfs', 'tok2.pdf')).toBeNull();
      expect(fakes.eventBus.published).toHaveLength(1);
    });

    it('treats a missing object as deleted', async () => {
      const { fakes } = await setup();
      const cert = await seed(fakes, { pdfPath: 'gone.pdf', pdfGeneratedAt: new Date() });
      const res = await revoke(cert.id);
      expect(res.json()).toMatchObject({ hasPdf: false });
      expect(res.json().warnings).toBeUndefined();
    });

    it('races with PDF generation: never leaves a PDF behind a revoked certificate', async () => {
      const { fakes } = await setup();
      const cert = await seed(fakes);
      const generate = async () => {
        const result = await fakes.certificates.setPdfPathIfAbsent(cert.id, {
          pdfPath: 'race.pdf',
          generatedAt: new Date(),
        });
        if (result?.winner) await putPdf(fakes, 'race.pdf');
        return result;
      };
      const [, generated] = await Promise.all([revoke(cert.id), generate()]);
      if (generated?.winner) {
        // The generator won: the reference was set before the revocation read it, so revoke
        // deleted the object; otherwise a later repeat call repairs it.
        await revoke(cert.id);
      }
      const stored = await fakes.certificates.getById(cert.id);
      expect(stored?.status).toBe('revoked');
      expect(stored?.pdfPath).toBeUndefined();
      expect(await fakes.storage.get('pdfs', 'race.pdf')).toBeNull();
    });

    it('answers 404 for an unknown or malformed ID', async () => {
      await setup();
      for (const id of ['unknown-unknown-unknown', 'x', 'a'.repeat(300)]) {
        const res = await revoke(id);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('NOT_FOUND');
      }
      expect((await revoke(asCertificateId('b'.repeat(22)))).statusCode).toBe(404);
    });

    it('validates the reason: required, 1 to 500 characters after normalisation, no extra fields', async () => {
      const { fakes } = await setup();
      const cert = await seed(fakes);
      const bad: unknown[] = [
        {},
        { reason: '' },
        { reason: '   ​ ' },
        { reason: 'x'.repeat(501) },
        { reason: 42 },
        { reason: 'ok', extra: true },
      ];
      for (const payload of bad) {
        const res = await revoke(cert.id, payload);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_FAILED');
      }
      expect((await fakes.certificates.getById(cert.id))?.status).toBe('active');
      expect((await revoke(cert.id, { reason: 'x'.repeat(500) })).statusCode).toBe(200);
    });

    it('answers 401 without a token and 403 for non-admins on the revoke route', async () => {
      const { app: ready } = await setup();
      let seen = 0;
      await forEachAdminRoute(ready, async (route) => {
        if (!route.url.includes('/certificates')) return;
        seen += 1;
        const none = await ready.inject({ method: route.method as 'POST', url: route.concreteUrl });
        const user = await ready.inject({
          method: route.method as 'POST',
          url: route.concreteUrl,
          headers: { authorization: `Bearer ${fakeToken('u1')}` },
        });
        expect([none.statusCode, user.statusCode]).toEqual([401, 403]);
      });
      expect(seen).toBeGreaterThanOrEqual(1);
    });
  });
}
