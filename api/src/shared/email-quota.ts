/** Counter keys of the daily e-mail quota (BEU-ICT/certificate-manager#374). */

const PROVIDER_PATTERN = /^[a-z0-9_-]{1,40}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Counters are kept this long after their day ends before the TTL policy may delete them. */
export const EMAIL_COUNTER_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

/** UTC calendar day of `date` as `YYYY-MM-DD`. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Start of the day after `date` in UTC. */
export function nextUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

/** Throws `RangeError` for a malformed provider or day (messages never echo the input). */
export function assertCounterKey(provider: string, day: string): void {
  if (!PROVIDER_PATTERN.test(provider)) throw new RangeError('invalid provider name');
  if (!DAY_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    throw new RangeError('day must be a UTC date YYYY-MM-DD');
  }
}

export function assertCap(cap: number): void {
  if (!Number.isSafeInteger(cap) || cap < 1) throw new RangeError('cap must be a positive integer');
}

/** Document id `<provider>:<YYYY-MM-DD>` in `email_counters`. */
export function emailCounterId(provider: string, day: string): string {
  assertCounterKey(provider, day);
  return `${provider}:${day}`;
}

/** When the counter of `day` may be deleted: two days after that day ends. */
export function emailCounterExpiry(day: string): Date {
  return new Date(
    Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000 + EMAIL_COUNTER_RETENTION_MS,
  );
}
