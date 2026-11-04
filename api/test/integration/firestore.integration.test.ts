import { beforeEach, describe, expect, it } from 'vitest';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

// TODO(Firestore adapter task): write and read through the Firestore repository adapter instead
// of the raw client. The adapter does not exist yet, so this test proves the emulator round trip
// and the reset helper that the adapter tests will rely on.
describe('Firestore emulator', () => {
  const db = getTestFirestore();

  beforeEach(resetFirestore);

  it('reads back a document that was written', async () => {
    await db.collection('organizations').doc('acme').set({ name: 'Acme', slug: 'acme' });

    const snapshot = await db.collection('organizations').doc('acme').get();

    expect(snapshot.exists).toBe(true);
    expect(snapshot.data()).toEqual({ name: 'Acme', slug: 'acme' });
  });

  it('resetFirestore removes all documents', async () => {
    await db.collection('organizations').doc('acme').set({ name: 'Acme' });
    await db.collection('events').doc('devfest').set({ name: 'DevFest' });

    await resetFirestore();

    expect((await db.collection('organizations').get()).empty).toBe(true);
    expect((await db.collection('events').get()).empty).toBe(true);
  });
});
