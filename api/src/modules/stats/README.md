# stats

Dashboard counts for administrators (`GET /api/v1/admin/stats`). Status: implemented (#134).

## Responsibility

Computes certificate, e-mail, template, organization and event totals with native `count()` aggregations only (never reads documents), caches the result per instance and protects the quota.

## Public interface

- `StatsService.get({ refresh, adminUid })` returns `{ generatedAt, certificates: { total, active, revoked, issuedLast30Days }, email: { pending, sent, failed, skipped }, templates: { total }, organizations: { total }, events: { total } }`.
- Cache: in memory per instance for `STATS_CACHE_SECONDS` (default 60, 0 disables). Concurrent computations are shared (single flight); a failed computation is not cached.
- `refresh: true` bypasses the cache but is limited to once per 10 s per admin (`RateLimitedError`, HTTP 429 with `Retry-After`), counted through the `RateLimiter` port with a hashed key.
- Counts come from the services of the owning modules (`certificateQueries.count`, `organizations.count`, `events.count`, `templates.count`), wired in `src/services.ts`.
- Events published: none. Events consumed: none.
- Ports used: `Clock`, `RateLimiter`.

## Owned data

None. The cost per computation is 11 count queries, about the number of index entries divided by 1,000 reads each (see `docs/cost-model.md`).

## Non-goals

Per-organization or per-event breakdowns and history (time series).
