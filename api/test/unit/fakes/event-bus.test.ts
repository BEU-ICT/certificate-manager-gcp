import { describe, expect, it } from 'vitest';
import type { EventBus } from '../../../src/ports/index.js';
import { asCertificateId } from '../../../src/shared/ids.js';
import { FakeEventBus } from '../../../src/testing/fakes/index.js';

const revoked = { certificateId: asCertificateId('a'.repeat(22)), occurredAt: new Date(0) };

/** Reusable behaviours every EventBus must show. */
export function eventBusBehaviour(make: () => EventBus): void {
  it('runs subscribers in registration order and awaits them', async () => {
    const bus = make();
    const calls: string[] = [];
    bus.subscribe('certificate.revoked', 'first', async () => {
      await Promise.resolve();
      calls.push('first');
    });
    bus.subscribe('certificate.revoked', 'second', () => {
      calls.push('second');
    });
    await bus.publish('certificate.revoked', revoked);
    expect(calls).toEqual(['first', 'second']);
  });

  it('never rejects when a subscriber fails and still runs the rest', async () => {
    const bus = make();
    let ran = false;
    bus.subscribe('certificate.revoked', 'bad', () => {
      throw new Error('boom');
    });
    bus.subscribe('certificate.revoked', 'good', () => {
      ran = true;
    });
    await expect(bus.publish('certificate.revoked', revoked)).resolves.toBeUndefined();
    expect(ran).toBe(true);
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = make();
    let n = 0;
    const off = bus.subscribe('certificate.revoked', 's', () => {
      n += 1;
    });
    await bus.publish('certificate.revoked', revoked);
    off();
    await bus.publish('certificate.revoked', revoked);
    expect(n).toBe(1);
  });
}

describe('FakeEventBus', () => {
  eventBusBehaviour(() => new FakeEventBus());

  it('records published events and subscriber errors', async () => {
    const bus = new FakeEventBus();
    bus.subscribe('certificate.revoked', 'bad', () => {
      throw new Error('boom');
    });
    await bus.publish('certificate.revoked', revoked);
    expect(bus.published).toEqual([{ type: 'certificate.revoked', payload: revoked }]);
    expect(bus.errors).toHaveLength(1);
    expect(bus.errors[0]?.subscriber).toBe('bad');
  });
});
