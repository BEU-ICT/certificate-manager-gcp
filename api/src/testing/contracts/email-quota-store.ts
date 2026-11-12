import { describe, it } from 'vitest';
import type { EmailQuotaStore } from '../../ports/index.js';
import { clause, type AdapterHandle } from './types.js';

const PORT = 'EmailQuotaStore';
const GRANT = 'tryReserve: grants while the counter is below the cap and increments it';
const DENY = 'tryReserve: otherwise nothing changes and granted is false';
const PARALLEL = 'tryReserve: for any number of concurrent callers exactly cap are granted';
const RELEASE = 'release: gives one slot back; never below 0; unknown counter is success';
const INPUT = 'Implementations throw RangeError for a malformed provider or day or a bad cap';

export type EmailQuotaStoreContractFactory = () =>
  Promise<AdapterHandle<EmailQuotaStore>> | AdapterHandle<EmailQuotaStore>;

const DAY = '2026-11-12';
const NEXT_DAY = '2026-11-13';

/** Executable form of the TSDoc on `EmailQuotaStore` (src/ports/email-quota-store.ts). */
export function describeEmailQuotaStoreContract(
  name: string,
  factory: EmailQuotaStoreContractFactory,
): void {
  const test = (title: string, body: (adapter: EmailQuotaStore) => Promise<void>) =>
    it(title, async () => {
      const handle = await factory();
      try {
        await body(handle.adapter);
      } finally {
        await handle.cleanup();
      }
    });

  describe(`EmailQuotaStore contract: ${name}`, () => {
    test('grants up to the cap, then denies without changing the counter', async (store) => {
      await clause(PORT, GRANT, 'first').resolvedTo(store.tryReserve('gmail', DAY, 2), {
        granted: true,
        used: 1,
      });
      await clause(PORT, GRANT, 'second').resolvedTo(store.tryReserve('gmail', DAY, 2), {
        granted: true,
        used: 2,
      });
      await clause(PORT, DENY, 'third').resolvedTo(store.tryReserve('gmail', DAY, 2), {
        granted: false,
        used: 2,
      });
      await clause(PORT, DENY, 'still denied').resolvedTo(store.tryReserve('gmail', DAY, 2), {
        granted: false,
        used: 2,
      });
    });

    test('providers and days are counted separately', async (store) => {
      await store.tryReserve('gmail', DAY, 1);
      await clause(PORT, GRANT, 'other provider').resolvedTo(store.tryReserve('brevo', DAY, 1), {
        granted: true,
        used: 1,
      });
      await clause(PORT, GRANT, 'next day').resolvedTo(store.tryReserve('gmail', NEXT_DAY, 1), {
        granted: true,
        used: 1,
      });
    });

    test('the cap is applied per call (a raised cap grants again)', async (store) => {
      await store.tryReserve('gmail', DAY, 1);
      await clause(PORT, DENY, 'cap 1').resolvedTo(store.tryReserve('gmail', DAY, 1), {
        granted: false,
        used: 1,
      });
      await clause(PORT, GRANT, 'cap 2').resolvedTo(store.tryReserve('gmail', DAY, 2), {
        granted: true,
        used: 2,
      });
    });

    test('release gives a slot back, never below 0, and ignores unknown counters', async (store) => {
      await clause(PORT, RELEASE, 'unknown counter').resolved(store.release('gmail', DAY));
      await store.tryReserve('gmail', DAY, 1);
      await clause(PORT, DENY, 'full').resolvedTo(store.tryReserve('gmail', DAY, 1), {
        granted: false,
        used: 1,
      });
      await store.release('gmail', DAY);
      await store.release('gmail', DAY);
      await clause(PORT, RELEASE, 'reusable and not negative').resolvedTo(
        store.tryReserve('gmail', DAY, 5),
        { granted: true, used: 1 },
      );
    });

    test('100 parallel reservations with cap 50 grant exactly 50', async (store) => {
      const results = await Promise.all(
        Array.from({ length: 100 }, () => store.tryReserve('gmail', DAY, 50)),
      );
      const granted = results.filter((r) => r.granted);
      clause(PORT, PARALLEL, 'granted').that(granted).toHaveLength(50);
      clause(PORT, PARALLEL, 'distinct counter values')
        .that(new Set(granted.map((r) => r.used)).size)
        .toBe(50);
      clause(PORT, PARALLEL, 'denied')
        .that(results.filter((r) => !r.granted))
        .toHaveLength(50);
    });

    test('rejects malformed provider, day and cap with RangeError', async (store) => {
      await clause(PORT, INPUT, 'provider').rejectedWith(
        store.tryReserve('Gmail!', DAY, 1),
        RangeError,
      );
      await clause(PORT, INPUT, 'day').rejectedWith(
        store.tryReserve('gmail', '2026-13-45', 1),
        RangeError,
      );
      await clause(PORT, INPUT, 'day format').rejectedWith(
        store.release('gmail', 'today'),
        RangeError,
      );
      await clause(PORT, INPUT, 'cap 0').rejectedWith(
        store.tryReserve('gmail', DAY, 0),
        RangeError,
      );
      await clause(PORT, INPUT, 'cap 1.5').rejectedWith(
        store.tryReserve('gmail', DAY, 1.5),
        RangeError,
      );
    });
  });
}
