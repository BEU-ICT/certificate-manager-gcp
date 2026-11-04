import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Spec §10: no client SDK path to data. Only the Admin SDK (which bypasses rules) may touch it.
const RULES = resolve(__dirname, '../../../infra/firestore.rules');
const COLLECTIONS = [
  'organizations',
  'events',
  'templates',
  'certificates',
  'admins',
  'uniques',
  'idempotency',
  'email_counters',
  'system',
  'some-unknown-collection',
];

let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8081').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-certificate-manager-rules',
    firestore: { rules: readFileSync(RULES, 'utf8'), host, port: Number(port) },
  });
  // Seed through the rules-bypassing context so reads would succeed if rules allowed them.
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const c of COLLECTIONS) await setDoc(doc(ctx.firestore(), c, 'seed'), { v: 1 });
  });
});

afterAll(async () => {
  await env.cleanup();
});

describe('firestore.rules', () => {
  const clients = {
    unauthenticated: () => env.unauthenticatedContext(),
    authenticated: () => env.authenticatedContext('user-1', { email: 'u@example.com' }),
    'admin claim': () =>
      env.authenticatedContext('admin-1', { role: 'admin', email: 'a@example.com' }),
  };

  for (const [name, ctx] of Object.entries(clients)) {
    describe(name, () => {
      for (const c of COLLECTIONS) {
        it(`denies read and write on ${c}`, async () => {
          const db = ctx().firestore();
          await assertFails(getDoc(doc(db, c, 'seed')));
          await assertFails(getDocs(collection(db, c)));
          await assertFails(setDoc(doc(db, c, 'new'), { v: 2 }));
          await assertFails(setDoc(doc(db, c, 'seed'), { v: 2 }));
          await assertFails(deleteDoc(doc(db, c, 'seed')));
        });
      }
    });
  }

  it('is a single deny-all rule', () => {
    const rules = readFileSync(RULES, 'utf8');
    expect(rules.match(/allow /g)).toHaveLength(1);
    expect(rules).toContain('allow read, write: if false;');
  });
});
