import { describe, expect, it } from 'vitest';
import { FirebaseAdminUserDirectory } from '../../src/adapters/firebase/admin-user-directory.js';
import { FirestoreMigrationStateStore } from '../../src/adapters/firestore/migration-state-store.js';
import { bootstrapAdmin } from '../../src/migrations/001-bootstrap-admin.js';
import { runMigrations } from '../../src/migrations/index.js';
import { TransientEmailError } from '../../src/ports/index.js';
import { createFakes } from '../../src/testing/fakes/index.js';
import {
  createMigrationContext,
  TEST_MIGRATION_SETTINGS,
} from '../../src/testing/migration-context.js';
import { getTestAuth, getTestFirestore, resetFirestore } from './helpers/index.js';

const auth = getTestAuth();

async function setup() {
  await resetFirestore();
  const email = `bootstrap-${crypto.randomUUID()}@example.test`;
  const fakes = createFakes();
  const adminUsers = new FirebaseAdminUserDirectory(auth);
  const context = createMigrationContext(fakes, {
    adminUsers,
    settings: { ...TEST_MIGRATION_SETTINGS, bootstrapAdminEmail: email },
  });
  const start = (instanceId: string) =>
    runMigrations({
      store: new FirestoreMigrationStateStore(getTestFirestore(), fakes.clock),
      context,
      instanceId,
      migrations: [bootstrapAdmin],
    });
  return { email, fakes, start };
}

describe('001-bootstrap-admin (Auth + Firestore emulators)', () => {
  it('creates user and claim, sends one e-mail with a link, and is a no-op the second time', async () => {
    const { email, fakes, start } = await setup();
    expect((await start('a')).applied).toEqual(['001-bootstrap-admin']);

    const user = await auth.getUserByEmail(email);
    expect(user.customClaims).toMatchObject({ role: 'admin' });
    expect(fakes.emailSender.sent).toHaveLength(1);
    expect(fakes.emailSender.sent[0]?.text).toMatch(/https?:\/\//);

    expect((await start('b')).applied).toEqual([]);
    expect(fakes.emailSender.sent).toHaveLength(1);
  });

  it('creates exactly one user and one e-mail for two concurrent runs', async () => {
    const { email, fakes, start } = await setup();
    await Promise.all([start('a'), start('b')]);
    expect(fakes.emailSender.sent).toHaveLength(1);
    expect((await auth.getUserByEmail(email)).email).toBe(email);
  });

  it('leaves no marker when sending fails and the rerun succeeds', async () => {
    const { fakes, start } = await setup();
    fakes.emailSender.failNext(new TransientEmailError('down'));
    await expect(start('a')).rejects.toThrow();
    expect(
      (await getTestFirestore().collection('system').doc('migrations').get()).data()?.['applied'] ??
        {},
    ).not.toHaveProperty('001-bootstrap-admin');
    expect((await start('b')).applied).toEqual(['001-bootstrap-admin']);
    expect(fakes.emailSender.sent).toHaveLength(1);
  });

  it('gives an existing user the claim without recreating it', async () => {
    const { email, start } = await setup();
    const existing = await auth.createUser({ email, password: 'integration-test-password' });
    await auth.setCustomUserClaims(existing.uid, { other: 'kept' });
    await start('a');
    const user = await auth.getUserByEmail(email);
    expect(user.uid).toBe(existing.uid);
    expect(user.customClaims).toEqual({ other: 'kept', role: 'admin' });
  });
});
