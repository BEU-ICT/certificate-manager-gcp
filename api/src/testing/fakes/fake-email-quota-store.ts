import type { EmailQuotaStore, QuotaReservation } from '../../ports/index.js';
import { assertCap, emailCounterId } from '../../shared/email-quota.js';

/**
 * In-memory counters. The body runs in one synchronous step (inside a resolved promise, so
 * validation errors reject like an adapter's), which makes reservations atomic.
 */
export class FakeEmailQuotaStore implements EmailQuotaStore {
  private readonly counters = new Map<string, number>();

  tryReserve(provider: string, day: string, cap: number): Promise<QuotaReservation> {
    return Promise.resolve().then(() => {
      assertCap(cap);
      const id = emailCounterId(provider, day);
      const used = this.counters.get(id) ?? 0;
      if (used >= cap) return { granted: false, used };
      this.counters.set(id, used + 1);
      return { granted: true, used: used + 1 };
    });
  }

  release(provider: string, day: string): Promise<void> {
    return Promise.resolve().then(() => {
      const id = emailCounterId(provider, day);
      const used = this.counters.get(id);
      if (used !== undefined) this.counters.set(id, Math.max(0, used - 1));
    });
  }

  /** Current counter value, for assertions. */
  used(provider: string, day: string): number {
    return this.counters.get(emailCounterId(provider, day)) ?? 0;
  }
}
