import { describe, expect, it, vi } from 'vitest';
import { bootstrapAdmin, bootstrapAdminMail } from '../../src/migrations/001-bootstrap-admin.js';
import { runMigrations } from '../../src/migrations/index.js';
import { TransientEmailError } from '../../src/ports/index.js';
import {
  createMigrationContext,
  TEST_MIGRATION_SETTINGS,
} from '../../src/testing/migration-context.js';
import { createFakes } from '../../src/testing/fakes/index.js';

function setup(settings = TEST_MIGRATION_SETTINGS) {
  const fakes = createFakes();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const context = createMigrationContext(fakes, { log, settings });
  const run = (instanceId = 'i1') =>
    runMigrations({
      store: fakes.migrationState,
      context,
      instanceId,
      migrations: [bootstrapAdmin],
    });
  return { fakes, log, run };
}

describe('001-bootstrap-admin', () => {
  it('creates the admin with the claim, sends one e-mail and marks the migration', async () => {
    const { fakes, run } = setup();
    const report = await run();
    expect(report.applied).toEqual(['001-bootstrap-admin']);
    expect(fakes.adminUsers.all()).toEqual([
      { uid: expect.any(String) as string, email: 'first-admin@example.test', role: 'admin' },
    ]);
    expect(fakes.emailSender.sent).toHaveLength(1);
    const [mail] = fakes.emailSender.sent;
    expect(mail?.to).toBe('first-admin@example.test');
    expect(mail?.text).toContain('https://auth.example.test/set-password?oob=1');
    expect(mail?.html).toContain('https://auth.example.test/set-password?oob=1');
    expect(mail?.text).toContain('https://app.example.test/login');
    expect(mail?.subject).toContain('Parolunuzu');
  });

  it('does nothing on the second run', async () => {
    const { fakes, run } = setup();
    await run();
    const report = await run('i2');
    expect(report.applied).toEqual([]);
    expect(fakes.emailSender.sent).toHaveLength(1);
    expect(fakes.adminUsers.all()).toHaveLength(1);
  });

  it('runs once for two concurrent instances', async () => {
    const { fakes, run } = setup();
    await Promise.all([run('a'), run('b')]);
    expect(fakes.emailSender.sent).toHaveLength(1);
    expect(fakes.adminUsers.all()).toHaveLength(1);
  });

  it('writes no marker when sending fails and succeeds on the retry without a second user', async () => {
    const { fakes, run } = setup();
    fakes.emailSender.failNext(new TransientEmailError('provider not configured'));
    await expect(run()).rejects.toThrow('001-bootstrap-admin');
    expect(fakes.migrationState.marker('001-bootstrap-admin')).toBeUndefined();

    const report = await run('i2');
    expect(report.applied).toEqual(['001-bootstrap-admin']);
    expect(fakes.adminUsers.all()).toHaveLength(1);
    expect(fakes.emailSender.sent).toHaveLength(1);
  });

  it('gives an existing user the claim without recreating it', async () => {
    const { fakes, run } = setup();
    const existing = await fakes.adminUsers.create({
      email: 'First-Admin@example.test',
      emailVerified: true,
    });
    await run();
    expect(fakes.adminUsers.all()).toEqual([
      { uid: existing.uid, email: 'first-admin@example.test', role: 'admin' },
    ]);
  });

  it('is deferred, not marked, when no admin e-mail is configured', async () => {
    const { fakes, log, run } = setup({ ...TEST_MIGRATION_SETTINGS, bootstrapAdminEmail: '' });
    const report = await run();
    expect(report.applied).toEqual([]);
    expect(report.deferred).toEqual(['001-bootstrap-admin']);
    expect(fakes.migrationState.marker('001-bootstrap-admin')).toBeUndefined();
    expect(fakes.emailSender.sent).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'bootstrap skipped, no admin configured' }),
      'migration deferred',
    );
  });

  it('never logs the password-setup link', async () => {
    const { log, run } = setup();
    await run();
    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(logged).not.toContain('set-password');
    expect(logged).not.toContain('first-admin@example.test');
  });

  it('escapes the link in the HTML body', () => {
    const mail = bootstrapAdminMail('https://x.test/?a=1&b="2"', 'https://app.test/login');
    expect(mail.html).not.toContain('b="2"');
    expect(mail.html).toContain('&#38;');
  });
});
