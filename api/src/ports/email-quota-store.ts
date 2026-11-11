/** Result of {@link EmailQuotaStore.tryReserve}. */
export interface QuotaReservation {
  /** `true` when one more e-mail may be sent today. */
  granted: boolean;
  /** Counter value after the call (never above the cap). */
  used: number;
}

/**
 * Daily sending counter per e-mail provider (BEU-ICT/certificate-manager#374). A counter is
 * identified by `(provider, day)`: `provider` is the configured provider name (e.g. `gmail`) and
 * `day` the UTC date `YYYY-MM-DD`. Implementations throw `RangeError` for a malformed provider or
 * day and for a cap that is not a positive safe integer.
 */
export interface EmailQuotaStore {
  /**
   * Atomically takes one slot: when the counter is below `cap` it is incremented and `granted` is
   * `true`; otherwise nothing changes and `granted` is `false`. For any number of concurrent
   * callers exactly `cap` reservations are granted. An unknown counter starts at 0.
   */
  tryReserve(provider: string, day: string, cap: number): Promise<QuotaReservation>;

  /**
   * Gives one slot back (an e-mail that was reserved but never delivered). The counter never goes
   * below 0; an unknown counter is left untouched and counts as success.
   */
  release(provider: string, day: string): Promise<void>;
}
