import { createHash } from 'node:crypto';
import type { CertificateFilter, Clock, RateLimiter } from '../../ports/index.js';
import { RateLimitedError } from '../../shared/errors.js';

export interface CertificateStats {
  total: number;
  active: number;
  revoked: number;
  issuedLast30Days: number;
}

export interface EmailStats {
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** Dashboard numbers; `generatedAt` is the (ISO-8601 UTC) time the numbers were computed. */
export interface AdminStats {
  generatedAt: string;
  certificates: CertificateStats;
  email: EmailStats;
  templates: { total: number };
  organizations: { total: number };
  events: { total: number };
}

export interface StatsService {
  /**
   * Cached for `STATS_CACHE_SECONDS` per instance; concurrent computations are shared.
   * `refresh` bypasses the cache but is limited to once per 10 s per admin (`RateLimitedError`).
   */
  get(options: { refresh: boolean; adminUid: string }): Promise<AdminStats>;
}

/** The count queries the statistics need, provided by the owning modules' services. */
export interface StatsSources {
  certificates: { count(filter: CertificateFilter): Promise<number> };
  organizations: { count(): Promise<number> };
  events: { count(): Promise<number> };
  templates: { count(): Promise<number> };
}

export const REFRESH_WINDOW_MS = 10_000;
const DAY_MS = 86_400_000;

export class DefaultStatsService implements StatsService {
  private cached: { value: AdminStats; computedAt: number } | undefined;
  private inFlight: Promise<AdminStats> | undefined;

  constructor(
    private readonly sources: StatsSources,
    private readonly clock: Clock,
    private readonly rateLimiter: RateLimiter,
    private readonly cacheSeconds: number,
  ) {}

  async get({ refresh, adminUid }: { refresh: boolean; adminUid: string }): Promise<AdminStats> {
    if (refresh) {
      // Hashed: limiter keys must not contain identifiers in clear text.
      const key = `stats-refresh:${createHash('sha256').update(adminUid).digest('hex').slice(0, 32)}`;
      const result = await this.rateLimiter.consume(key, { limit: 1, windowMs: REFRESH_WINDOW_MS });
      if (!result.allowed) {
        const waitMs = result.resetAt.getTime() - this.clock.now().getTime();
        throw new RateLimitedError(Math.max(1, Math.ceil(waitMs / 1000)));
      }
    } else if (this.cached && this.clock.now().getTime() - this.cached.computedAt < this.ttlMs) {
      return this.cached.value;
    }
    // Single flight: concurrent callers (refresh included) await the computation already running.
    this.inFlight ??= this.compute().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private get ttlMs(): number {
    return this.cacheSeconds * 1000;
  }

  private async compute(): Promise<AdminStats> {
    const now = this.clock.now();
    const c = (filter: CertificateFilter) => this.sources.certificates.count(filter);
    const [
      total,
      active,
      revoked,
      issuedLast30Days,
      pending,
      sent,
      failed,
      skipped,
      templates,
      organizations,
      events,
    ] = await Promise.all([
      c({}),
      c({ status: 'active' }),
      c({ status: 'revoked' }),
      c({ issuedFrom: new Date(now.getTime() - 30 * DAY_MS) }),
      c({ emailStatus: 'pending' }),
      c({ emailStatus: 'sent' }),
      c({ emailStatus: 'failed' }),
      c({ emailStatus: 'skipped' }),
      this.sources.templates.count(),
      this.sources.organizations.count(),
      this.sources.events.count(),
    ]);
    const value: AdminStats = {
      generatedAt: now.toISOString(),
      certificates: { total, active, revoked, issuedLast30Days },
      email: { pending, sent, failed, skipped },
      templates: { total: templates },
      organizations: { total: organizations },
      events: { total: events },
    };
    this.cached = { value, computedAt: now.getTime() };
    return value;
  }
}
