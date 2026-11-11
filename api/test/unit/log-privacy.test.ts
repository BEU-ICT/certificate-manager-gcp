/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- HTTP response bodies are untyped JSON. */
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { FitChecker } from '../../src/modules/certificates/index.js';
import { buildServices } from '../../src/services.js';
import { sampleTemplate } from '../../src/testing/contracts/index.js';
import { createFakes, fakeToken } from '../../src/testing/fakes/index.js';
import { captureLogs, privacyViolations } from '../helpers/log-capture.js';

const OWNER = 'Aysel Məmmədova';
const EMAIL = 'aysel.private@example.com';
const SUBJECT = 'Confidential cloud workshop';
const SKILL = 'SecretSkill';
const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
const fit: FitChecker = { checkFit: () => Promise.resolve({ fits: true, issues: [] }) };

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Runs the log-emitting flows at `debug` level and returns everything that was logged. */
async function run() {
  const logs = captureLogs();
  const fakes = createFakes();
  app = buildApp({
    ports: fakes,
    services: buildServices(fakes, undefined, { fitChecker: fit }),
    adminRateLimitPerMin: 100_000,
    log: { level: 'debug', destination: logs.stream },
  });
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app!.inject({ method, url, headers: admin, ...(payload && { payload }) });

  const org = (await call('POST', '/api/v1/admin/organizations', { name: 'Acme' })).json();
  const event = (
    await call('POST', '/api/v1/admin/events', { organizationId: org.id, name: 'DevFest' })
  ).json();
  await fakes.templates.create(
    sampleTemplate({ organizationId: org.id, eventId: event.id, version: 0 }),
  );
  const issued = await call('POST', '/api/v1/admin/certificates', {
    organizationId: org.id,
    eventId: event.id,
    type: 'attendance',
    ownerName: OWNER,
    email: EMAIL,
    subject: SUBJECT,
    skills: [SKILL],
  });
  expect(issued.statusCode).toBe(201);
  const id = issued.json().id as string;
  await call('POST', `/api/v1/admin/certificates/${id}/revoke`, { reason: 'duplicate' });
  await app.inject({ method: 'GET', url: `/api/v1/public/certificates/${id}` });
  await app.inject({ method: 'GET', url: '/api/v1/public/certificates/unknown-id-1234' });
  // Failed authentication with a token-shaped header and a malformed body.
  await app.inject({
    method: 'GET',
    url: '/api/v1/admin/organizations',
    headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln' },
  });
  await call('POST', '/api/v1/admin/certificates', { ownerName: OWNER, email: EMAIL });
  // Rejected (still referenced): a refused mutation writes no audit entry.
  await call('DELETE', `/api/v1/admin/events/${event.id}`);
  return { logs, id, org, event };
}

describe('log privacy', () => {
  it('never logs e-mail addresses, JWTs, names, subjects or skills', async () => {
    const { logs } = await run();
    expect(logs.lines().length).toBeGreaterThan(5);
    expect(privacyViolations(logs.raw(), [OWNER, EMAIL, SUBJECT, SKILL])).toEqual([]);
  });

  it('logs every request once, with requestId exactly once per line', async () => {
    const { logs } = await run();
    for (const line of logs.raw().split('\n').filter(Boolean)) {
      expect(line.match(/"requestId"/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
    const completed = logs.lines().filter((l) => l['message'] === 'request completed');
    for (const l of completed) expect(l).toHaveProperty('requestId');
  });

  it('logs unknown public IDs at INFO without the ID', async () => {
    const { logs } = await run();
    expect(logs.raw()).not.toContain('unknown-id-1234');
    const rejected = logs
      .lines()
      .filter((l) => l['message'] === 'request rejected' && l['status'] === 404);
    expect(rejected.length).toBeGreaterThan(0);
    for (const l of rejected) expect(l['severity']).toBe('INFO');
  });
});

describe('audit entries', () => {
  it('each successful admin mutation emits exactly one audit entry, a rejected one none', async () => {
    const { logs, id, org, event } = await run();
    const audits = logs.lines().filter((l) => l['audit'] === true);
    expect(audits.map((a) => [a['action'], a['entityId']])).toEqual([
      ['organization.create', org.id],
      ['event.create', event.id],
      ['certificate.issued', id],
      ['certificate.revoked', id],
    ]);
    for (const a of audits) {
      expect(a).toMatchObject({ severity: 'INFO', outcome: 'success', adminUid: 'admin-1' });
    }
  });
});
