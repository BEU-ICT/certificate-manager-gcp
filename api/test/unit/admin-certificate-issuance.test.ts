/* eslint-disable @typescript-eslint/no-unsafe-member-access -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FitChecker } from '../../src/modules/certificates/index.js';
import type { FitResult } from '../../src/modules/pdf/index.js';
import { buildServices } from '../../src/services.js';
import {
  sampleEvent,
  sampleOrganization,
  sampleTemplate,
} from '../../src/testing/contracts/index.js';
import { createFakes, fakeToken } from '../../src/testing/fakes/index.js';
import { describeCertificateIssuanceApi } from '../helpers/certificate-issuance-api-suite.js';

describeCertificateIssuanceApi('in-memory fakes', () => createFakes());

class RecordingFitChecker implements FitChecker {
  calls = 0;
  checkFit(): Promise<FitResult> {
    this.calls += 1;
    return Promise.resolve({ fits: true, issues: [] });
  }
}

describe('issuance side effects', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('only calls checkFit: no Cloud Storage access and no PDF rendering', async () => {
    const fakes = createFakes();
    const fit = new RecordingFitChecker();
    const org = sampleOrganization();
    const event = sampleEvent({ organizationId: org.id });
    await fakes.organizations.create(org);
    await fakes.events.create(event);
    await fakes.templates.create(
      sampleTemplate({ organizationId: org.id, eventId: event.id, version: 1 }),
    );
    const services = buildServices(fakes, undefined, { fitChecker: fit });

    const storageCalls: string[] = [];
    const storage = fakes.storage as unknown as Record<string, unknown>;
    for (const method of ['put', 'putIfAbsent', 'get', 'delete', 'copy', 'list', 'publicUrl']) {
      const original = (storage[method] as (...a: unknown[]) => unknown).bind(storage);
      storage[method] = (...a: unknown[]) => {
        storageCalls.push(method);
        return original(...a);
      };
    }
    const renderCalls: string[] = [];
    const pdf = services.pdf as unknown as Record<string, unknown>;
    for (const method of ['render', 'preview']) {
      const original = (pdf[method] as (...a: unknown[]) => unknown).bind(pdf);
      pdf[method] = (...a: unknown[]) => {
        renderCalls.push(method);
        return original(...a);
      };
    }

    app = buildApp({ ports: fakes, services, adminRateLimitPerMin: 100_000 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/certificates',
      headers: { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` },
      payload: {
        organizationId: org.id,
        eventId: event.id,
        type: 'attendance',
        ownerName: 'Aysel Məmmədova',
        subject: 'Cloud workshop',
        email: 'a@example.com',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().pdfUrl).toBeNull();
    expect(fit.calls).toBe(1);
    expect(storageCalls).toEqual([]);
    expect(fakes.storage.objects.size).toBe(0);
    expect(renderCalls).toEqual([]);
  });
});
