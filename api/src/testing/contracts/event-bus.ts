import { describe, it } from 'vitest';
import type { DomainEvents, EventBus } from '../../ports/index.js';
import { asCertificateId } from '../../shared/ids.js';
import { clause, withAdapter, type ContractFactory } from './types.js';

const PORT = 'EventBus';
const ORDER = 'publish: Resolves after every subscriber ran, in registration order';
const FAILING = 'publish: A failing subscriber is logged and never makes publish reject';
const UNSUBSCRIBE = 'subscribe: Returns an unsubscribe function';

const revoked: DomainEvents['certificate.revoked'] = {
  certificateId: asCertificateId('a'.repeat(22)),
  occurredAt: new Date('2026-01-01T00:00:00.000Z'),
};

/** Executable form of the TSDoc on `EventBus` (src/ports/event-bus.ts). */
export function describeEventBusContract(name: string, factory: ContractFactory<EventBus>): void {
  const test = (title: string, body: (bus: EventBus) => Promise<void>) =>
    it(title, () => withAdapter(factory, body));

  describe(`EventBus contract: ${name}`, () => {
    test('delivers the payload to subscribers of that type only', async (bus) => {
      const received: unknown[] = [];
      bus.subscribe('certificate.revoked', 'revoked', (p) => void received.push(p));
      bus.subscribe('certificate.issued', 'issued', () => void received.push('wrong type'));
      await bus.publish('certificate.revoked', revoked);
      clause(PORT, 'subscribe: handler receives the published payload of its type', 'delivery')
        .that(received)
        .toEqual([revoked]);
    });

    test('runs subscribers in registration order and resolves after all ran', async (bus) => {
      const calls: string[] = [];
      bus.subscribe('certificate.revoked', 'slow', async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        calls.push('slow');
      });
      bus.subscribe('certificate.revoked', 'fast', () => void calls.push('fast'));
      await bus.publish('certificate.revoked', revoked);
      clause(PORT, ORDER, `calls observed after publish resolved: [${calls.join(', ')}]`)
        .that(calls)
        .toEqual(['slow', 'fast']);
    });

    test('a failing subscriber never makes publish reject and does not stop the others', async (bus) => {
      const calls: string[] = [];
      bus.subscribe('certificate.revoked', 'throws', () => {
        throw new Error('sync boom');
      });
      bus.subscribe('certificate.revoked', 'rejects', () =>
        Promise.reject(new Error('async boom')),
      );
      bus.subscribe('certificate.revoked', 'after', () => void calls.push('after'));
      await clause(PORT, FAILING, 'publish must resolve although subscribers fail').resolved(
        bus.publish('certificate.revoked', revoked),
      );
      clause(PORT, FAILING, 'subscribers registered after a failing one still run')
        .that(calls)
        .toEqual(['after']);
    });

    test('unsubscribe stops delivery to that subscriber only', async (bus) => {
      const calls: string[] = [];
      const off = bus.subscribe('certificate.revoked', 'a', () => void calls.push('a'));
      bus.subscribe('certificate.revoked', 'b', () => void calls.push('b'));
      off();
      await bus.publish('certificate.revoked', revoked);
      clause(PORT, UNSUBSCRIBE, 'unsubscribed handler must not be called, others must')
        .that(calls)
        .toEqual(['b']);
      off();
      await clause(PORT, UNSUBSCRIBE, 'calling it twice is harmless').resolved(
        bus.publish('certificate.revoked', revoked),
      );
    });

    test('publishing without subscribers resolves', async (bus) => {
      await clause(PORT, ORDER, 'no subscribers').resolved(
        bus.publish('certificate.revoked', revoked),
      );
    });

    test('a handler may be registered by several subscribers under different names', async (bus) => {
      let count = 0;
      const handler = () => void count++;
      bus.subscribe('certificate.revoked', 'one', handler);
      bus.subscribe('certificate.revoked', 'two', handler);
      await bus.publish('certificate.revoked', revoked);
      clause(PORT, 'subscribe: name identifies the subscriber in logs', 'each subscription runs')
        .that(count)
        .toBe(2);
    });
  });
}
