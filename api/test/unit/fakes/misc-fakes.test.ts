import { describe, expect, it } from 'vitest';
import {
  PermanentEmailError,
  type EmailMessage,
  type ScheduledJob,
} from '../../../src/ports/index.js';
import { UnauthenticatedError } from '../../../src/shared/errors.js';
import { isCertificateId } from '../../../src/shared/ids.js';
import {
  FakeClock,
  FakeEmailSender,
  FakeIdGenerator,
  FakeScheduler,
  FakeTaskRequestVerifier,
  FakeTokenVerifier,
  TEST_ADMIN,
  TEST_ADMIN_TOKEN,
  TEST_TASK_CREDENTIAL,
} from '../../../src/testing/fakes/index.js';

describe('FakeClock', () => {
  it('is fixed until advanced or set, and returns fresh Date objects', () => {
    const clock = new FakeClock(new Date('2026-05-01T00:00:00Z'));
    const a = clock.now();
    expect(clock.now().getTime()).toBe(a.getTime());
    a.setFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-05-01T00:00:00.000Z');
    clock.advance(1500);
    expect(clock.now().toISOString()).toBe('2026-05-01T00:00:01.500Z');
    clock.set(new Date(0));
    expect(clock.now().getTime()).toBe(0);
  });
});

describe('FakeIdGenerator', () => {
  it('yields valid, unique, deterministic ids and honours queued values', () => {
    const g = new FakeIdGenerator();
    const a = g.newCertificateId();
    const b = g.newCertificateId();
    expect(a).not.toBe(b);
    expect(isCertificateId(a)).toBe(true);
    expect(new FakeIdGenerator().newCertificateId()).toBe(a);
    g.queueCertificateIds('Z'.repeat(22));
    g.queueTokens('fixed');
    expect(g.newCertificateId()).toBe('Z'.repeat(22));
    expect(g.newToken()).toBe('fixed');
    expect(g.newToken()).toBe('token-1');
    expect(g.newCertificateId()).not.toBe(b);
  });

  it('rejects queued ids that are not valid certificate ids', () => {
    const g = new FakeIdGenerator();
    g.queueCertificateIds('short');
    expect(() => g.newCertificateId()).toThrow(TypeError);
  });
});

describe('FakeEmailSender', () => {
  const msg = (messageId: string): EmailMessage => ({
    to: 'a@example.test',
    from: 'b@example.test',
    subject: 's',
    text: 't',
    html: '<p>t</p>',
    messageId,
  });

  it('records messages and is idempotent per messageId', async () => {
    const s = new FakeEmailSender();
    const first = await s.send(msg('<1@x>'));
    const again = await s.send(msg('<1@x>'));
    await s.send(msg('<2@x>'));
    expect(again).toEqual(first);
    expect(s.sent.map((m) => m.messageId)).toEqual(['<1@x>', '<2@x>']);
  });

  it('fails the queued number of times without recording', async () => {
    const s = new FakeEmailSender();
    s.failNext(new PermanentEmailError('rejected'));
    await expect(s.send(msg('<1@x>'))).rejects.toBeInstanceOf(PermanentEmailError);
    expect(s.sent).toHaveLength(0);
    await expect(s.send(msg('<1@x>'))).resolves.toBeDefined();
  });
});

describe('FakeScheduler', () => {
  it('registers idempotently by name, replacing the definition', async () => {
    const s = new FakeScheduler();
    const job: ScheduledJob = { name: 'j', schedule: '* * * * *', handler: '/internal/a' };
    await s.register(job);
    await s.register({ ...job, schedule: '0 * * * *' });
    await s.register({ name: 'k', schedule: '0 0 * * *', handler: '/internal/b' });
    const jobs = await s.list();
    expect(jobs.map((j) => j.name)).toEqual(['j', 'k']);
    expect(jobs[0]?.schedule).toBe('0 * * * *');
  });
});

describe('verifier fakes', () => {
  it('token verifier accepts the test admin and registered tokens only', async () => {
    const v = new FakeTokenVerifier();
    expect(await v.verify(TEST_ADMIN_TOKEN)).toEqual(TEST_ADMIN);
    await expect(v.verify('nope')).rejects.toBeInstanceOf(UnauthenticatedError);
    v.allow('t2', { uid: 'u2', email: 'u2@example.test', role: 'admin' });
    expect((await v.verify('t2')).uid).toBe('u2');
    v.revoke('t2');
    await expect(v.verify('t2')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(await v.verify('fake:u3:admin')).toEqual({
      uid: 'u3',
      email: 'u3@example.test',
      role: 'admin',
    });
    expect((await v.verify('fake:u4:')).role).toBeUndefined();
    await expect(v.verify('fake:u4')).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('task verifier requires the exact credential', async () => {
    const v = new FakeTaskRequestVerifier();
    expect((await v.verify(TEST_TASK_CREDENTIAL)).identity).toBeTruthy();
    await expect(v.verify(undefined)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(v.verify('Bearer other')).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
