import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { InProcessEventBus } from '../../src/adapters/in-process/event-bus.js';
import type { DomainEvents, EventBus } from '../../src/ports/event-bus.js';
import type { CertificateId, EventId, OrganizationId } from '../../src/shared/ids.js';

const revoked: DomainEvents['certificate.revoked'] = {
  certificateId: 'c'.repeat(22) as CertificateId,
  occurredAt: new Date('2026-01-01T00:00:00Z'),
};
const issued: DomainEvents['certificate.issued'] = {
  ...revoked,
  organizationId: 'org-1' as OrganizationId,
  eventId: 'evt-1' as EventId,
  hasEmail: true,
};

function setup() {
  const logger = { error: vi.fn() };
  return { logger, bus: new InProcessEventBus(logger) };
}

describe('InProcessEventBus', () => {
  it('delivers sequentially in registration order and resolves after all ran', async () => {
    const { bus } = setup();
    const calls: string[] = [];
    bus.subscribe('certificate.revoked', 'a', async () => {
      await new Promise((r) => setTimeout(r, 10));
      calls.push('a');
    });
    bus.subscribe('certificate.revoked', 'b', () => {
      calls.push('b');
    });
    bus.subscribe('certificate.revoked', 'c', () => {
      calls.push('c');
      return Promise.resolve();
    });
    await bus.publish('certificate.revoked', revoked);
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('only delivers to subscribers of the published type, with the payload', async () => {
    const { bus } = setup();
    const onIssued = vi.fn();
    const onRevoked = vi.fn();
    bus.subscribe('certificate.issued', 'i', onIssued);
    bus.subscribe('certificate.revoked', 'r', onRevoked);
    await bus.publish('certificate.issued', issued);
    expect(onIssued).toHaveBeenCalledExactlyOnceWith(issued);
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it('resolves without subscribers', async () => {
    await expect(setup().bus.publish('certificate.revoked', revoked)).resolves.toBeUndefined();
  });

  it('isolates a synchronously throwing subscriber and logs it', async () => {
    const { bus, logger } = setup();
    const after = vi.fn();
    bus.subscribe('certificate.revoked', 'boom', () => {
      throw new Error('sync failure');
    });
    bus.subscribe('certificate.revoked', 'after', after);
    await expect(bus.publish('certificate.revoked', revoked)).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    const [obj, msg] = logger.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(obj).toMatchObject({ eventType: 'certificate.revoked', subscriber: 'boom' });
    expect(JSON.stringify(obj)).not.toContain(revoked.certificateId);
    expect(msg).toBeTypeOf('string');
  });

  it('isolates a rejecting subscriber and logs it', async () => {
    const { bus, logger } = setup();
    const after = vi.fn();
    bus.subscribe('certificate.issued', 'reject', () => Promise.reject(new Error('async failure')));
    bus.subscribe('certificate.issued', 'after', after);
    await expect(bus.publish('certificate.issued', issued)).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'certificate.issued',
      subscriber: 'reject',
    });
  });

  it('does not deliver to an unsubscribed handler', async () => {
    const { bus } = setup();
    const kept = vi.fn();
    const removed = vi.fn();
    const unsubscribe = bus.subscribe('certificate.revoked', 'removed', removed);
    bus.subscribe('certificate.revoked', 'kept', kept);
    unsubscribe();
    unsubscribe(); // idempotent
    await bus.publish('certificate.revoked', revoked);
    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledOnce();
  });

  it('skips a handler unsubscribed during an in-flight publish', async () => {
    const { bus } = setup();
    const second = vi.fn();
    let unsubscribeSecond: () => void = () => undefined;
    bus.subscribe('certificate.revoked', 'first', () => {
      unsubscribeSecond();
    });
    unsubscribeSecond = bus.subscribe('certificate.revoked', 'second', second);
    await bus.publish('certificate.revoked', revoked);
    expect(second).not.toHaveBeenCalled();
  });

  it('does not deliver the in-flight event to a subscriber registered during publish', async () => {
    const { bus } = setup();
    const late = vi.fn();
    bus.subscribe('certificate.revoked', 'first', () => {
      bus.subscribe('certificate.revoked', 'late', late);
    });
    await bus.publish('certificate.revoked', revoked);
    expect(late).not.toHaveBeenCalled();
    await bus.publish('certificate.revoked', revoked);
    expect(late).toHaveBeenCalledOnce();
  });

  it('supports adding a subscriber without changing publisher code', async () => {
    const { bus } = setup();
    // Publisher code: depends only on the port and never knows its subscribers.
    const revokeCertificate = (events: EventBus) => events.publish('certificate.revoked', revoked);

    const audit = vi.fn();
    bus.subscribe('certificate.revoked', 'audit', audit);
    await revokeCertificate(bus);
    const notify = vi.fn();
    bus.subscribe('certificate.revoked', 'notify', notify); // composition root only
    await revokeCertificate(bus);

    expect(audit).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledOnce();
  });
});

describe('EventBus payload type safety (compile-time)', () => {
  it('types handler payloads by event type', () => {
    const { bus } = setup();
    bus.subscribe('certificate.issued', 'typed', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<DomainEvents['certificate.issued']>();
      expectTypeOf(payload.hasEmail).toEqualTypeOf<boolean>();
      // @ts-expect-error certificate.issued has no `reason` field
      void payload.reason;
    });
    bus.subscribe('certificate.revoked', 'typed', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<DomainEvents['certificate.revoked']>();
      // @ts-expect-error certificate.revoked has no `hasEmail` field
      void payload.hasEmail;
    });
  });

  it('rejects wrong payloads and unknown event types', async () => {
    const { bus } = setup();
    // @ts-expect-error revoked payload is missing issued fields
    await bus.publish('certificate.issued', revoked);
    // @ts-expect-error unknown field not allowed on revoked payload
    await bus.publish('certificate.revoked', { ...revoked, email: 'a@b.c' });
    // @ts-expect-error unknown event type
    await bus.publish('certificate.unknown', revoked);
    // @ts-expect-error unknown event type
    bus.subscribe('certificate.unknown', 'x', () => undefined);
    // @ts-expect-error plain strings are not branded ids
    await bus.publish('certificate.revoked', { certificateId: 'abc', occurredAt: new Date() });
  });
});
