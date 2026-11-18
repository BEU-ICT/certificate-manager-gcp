import type { EmailQuotaStore, QuotaReservation } from '../../ports/index.js';
import { assertCap, emailCounterExpiry, emailCounterId } from '../../shared/email-quota.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';
import type { Queryable } from './db.js';

/**
 * PostgreSQL {@link EmailQuotaStore}. `tryReserve` is one upsert whose update only fires below
 * the cap, so concurrent callers (on any instance) are serialised by the row lock and exactly
 * `cap` reservations are granted.
 */
export class PostgresEmailQuotaStore implements EmailQuotaStore {
  constructor(private readonly db: Queryable) {}

  async tryReserve(provider: string, day: string, cap: number): Promise<QuotaReservation> {
    assertCap(cap);
    const id = emailCounterId(provider, day);
    const r = await this.db.query<{ used: number }>(
      `INSERT INTO email_counters (id, used, expires_at, schema_version) VALUES ($1, 1, $3, $4)
       ON CONFLICT (id) DO UPDATE SET used = email_counters.used + 1
       WHERE email_counters.used < $2 RETURNING used`,
      [id, cap, emailCounterExpiry(day), SCHEMA_VERSION],
    );
    if (r.rows[0]) return { granted: true, used: r.rows[0].used };
    const { rows } = await this.db.query<{ used: number }>(
      'SELECT used FROM email_counters WHERE id = $1',
      [id],
    );
    return { granted: false, used: rows[0]?.used ?? 0 };
  }

  async release(provider: string, day: string): Promise<void> {
    await this.db.query('UPDATE email_counters SET used = used - 1 WHERE id = $1 AND used > 0', [
      emailCounterId(provider, day),
    ]);
  }
}
