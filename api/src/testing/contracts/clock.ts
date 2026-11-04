import { describe, it } from 'vitest';
import type { Clock, IdGenerator } from '../../ports/index.js';
import { isCertificateId } from '../../shared/ids.js';
import { clause, withAdapter, type ContractFactory } from './types.js';

/** Executable form of the TSDoc on `Clock` (src/ports/clock.ts). */
export function describeClockContract(name: string, factory: ContractFactory<Clock>): void {
  const test = (title: string, body: (clock: Clock) => void) =>
    it(title, () => withAdapter(factory, body));

  describe(`Clock contract: ${name}`, () => {
    test('now() returns a valid Date', (clock) => {
      const now = clock.now();
      clause('Clock', 'now(): returns a Date', 'instance type').that(now).toBeInstanceOf(Date);
      clause('Clock', 'now(): returns a Date', 'valid time value')
        .that(Number.isNaN(now.getTime()))
        .toBe(false);
    });

    test('time never goes backwards', (clock) => {
      let previous = clock.now().getTime();
      for (let i = 0; i < 100; i++) {
        const current = clock.now().getTime();
        clause('Clock', 'Source of time: successive now() calls are non-decreasing', `call ${i}`)
          .that(current >= previous)
          .toBe(true);
        previous = current;
      }
    });

    test('mutating a returned Date does not change the clock', (clock) => {
      const first = clock.now();
      const before = first.getTime();
      first.setFullYear(1999);
      clause('Clock', 'now(): returns a fresh Date each call', 'caller mutation must not leak')
        .that(clock.now().getTime() >= before)
        .toBe(true);
    });
  });
}

/** Executable form of the TSDoc on `IdGenerator` (src/ports/id-generator.ts). */
export function describeIdGeneratorContract(
  name: string,
  factory: ContractFactory<IdGenerator>,
): void {
  const test = (title: string, body: (ids: IdGenerator) => void) =>
    it(title, () => withAdapter(factory, body));

  describe(`IdGenerator contract: ${name}`, () => {
    test('entity IDs are 22-char base64url and unique', (ids) => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const id = ids.newEntityId();
        clause('IdGenerator', 'newEntityId: 22-char base64url from 16 random bytes', id)
          .that(/^[A-Za-z0-9_-]{22}$/.test(id))
          .toBe(true);
        seen.add(id);
      }
      clause('IdGenerator', 'newEntityId: IDs are unique', '50 calls').that(seen.size).toBe(50);
    });

    test('certificate IDs are 22-char base64url', (ids) => {
      for (let i = 0; i < 50; i++) {
        const id = ids.newCertificateId();
        clause('IdGenerator', 'newCertificateId: 22-char base64url from 16 random bytes', id)
          .that(/^[A-Za-z0-9_-]{22}$/.test(id))
          .toBe(true);
        clause('IdGenerator', 'newCertificateId: result is a valid CertificateId', id)
          .that(isCertificateId(id))
          .toBe(true);
      }
    });

    test('certificate IDs are unique', (ids) => {
      const seen = new Set(Array.from({ length: 1000 }, () => ids.newCertificateId()));
      clause('IdGenerator', 'newCertificateId: IDs do not repeat', 'unique among 1000 draws')
        .that(seen.size)
        .toBe(1000);
    });

    test('tokens are non-empty URL-safe strings', (ids) => {
      for (let i = 0; i < 50; i++) {
        const token = ids.newToken();
        clause('IdGenerator', 'newToken: Unguessable URL-safe token', `"${token}"`)
          .that(/^[A-Za-z0-9_-]+$/.test(token))
          .toBe(true);
      }
    });

    test('tokens are unique', (ids) => {
      const seen = new Set(Array.from({ length: 1000 }, () => ids.newToken()));
      clause('IdGenerator', 'newToken: Unguessable (no repeats)', 'unique among 1000 draws')
        .that(seen.size)
        .toBe(1000);
    });
  });
}
