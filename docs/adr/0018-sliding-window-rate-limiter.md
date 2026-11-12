# 0018 In-process sliding-window rate limiter

Status: proposed · Spec §10 · Issue/PR: BEU-ICT/certificate-manager#387 (story BEU-ICT/certificate-manager#386; follow-ups #394 load script, #427 shared store)

## Context

The public verification endpoints (`/api/v1/public/**`) are unauthenticated and keyed by knowing a certificate ID, so they must be throttled per client to make ID enumeration impractical. Admin routes need a per-admin budget and a pre-authentication throttle against token guessing. Cloud Run runs up to 3 instances (`max-instances=3`); a shared store (Redis, #427) is out of scope for now.

## Decision

- **Port** `RateLimiter.consume(key, { limit, windowMs })` is unchanged. Its adapter `InProcessRateLimiter` is a **sliding-window counter**: two adjacent fixed windows, the previous one weighted by its remaining overlap, estimated from the actual first-to-last span of that window's admitted requests (a single request or a pure burst is admitted again exactly `windowMs` later). `consume` is O(1); the map is capped at 50 000 keys with LRU eviction (Map insertion order, refreshed on use); an unref'd timer sweeps idle keys; the clock is the injected `Clock` and never moves backwards.
- **Scopes** (all keys hold only a hash of the IP, `getClientIp` from ADR 0017; admin keys use the verified uid):

  | Scope               | Key                   | Default                                  |
  | ------------------- | --------------------- | ---------------------------------------- |
  | `/api/v1/public/**` | `public:<hash(ip)>`   | `RATE_LIMIT_PUBLIC_PER_MIN` = 10         |
  | admin, before auth  | `admin-auth:ip:...`   | 2 x per-admin limit per IP (120)         |
  | admin, after auth   | `admin:<uid>`         | `RATE_LIMIT_ADMIN_PER_MIN` = 60 (30-100) |
  | `/internal/**`      | `internal:<hash(ip)>` | 120 per minute per IP (constant)         |

- The public budget is **one shared counter** for all public routes (details + PDF) and is enforced in a root `onRequest` hook, before routing logic, validation and any handler: a limited request costs zero database reads, and unknown or malformed IDs consume the budget like valid ones (no oracle). A bulk issuance is one HTTP request and therefore counts once.
- Responses: `429 RATE_LIMITED` (standard error body) with `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds); successful responses carry the `RateLimit-*` headers.
- Metrics: per-scope request and limited counts, logged once a minute at INFO (WARNING above 50% limited). No IPs, uids or keys are logged.
- `/internal/**` exists to stop floods of forged requests. Cloud Tasks dispatches about 1 task/s and retries any non-2xx (including 429) with backoff, so 120/min per IP cannot lose a task.

- **Deliberate deviation from the issue (30/min pre-auth):** the pre-auth IP budget is twice the per-admin limit (default 120; `server.ts` derives it from `RATE_LIMIT_ADMIN_PER_MIN`, no new env key). With 30 a valid admin could never reach their own per-uid budget and two admins behind one NAT would starve each other. Its purpose is to throttle token guessing, not legitimate traffic.
- `/internal/send-email` also keeps its older route-level limiter (600/min), which is redundant with the stricter 120/min edge scope when that is configured; it stays because it works without the edge option.
- The monotonic guard is `Math.max(lastSeen, clock.now())` on the injected wall clock: a backwards jump freezes the limiter (counters stop advancing) until the clock catches up.

## Consequences

- **Per instance, not global.** Each instance keeps its own counters, so the effective public budget is up to 10 x 3 = 30 requests/minute per client with `max-instances=3`, and a restart resets the counters. Accepted: the goal is to make enumeration slow, not to enforce an exact quota.
- **Shared NAT.** Users behind one address (campus networks!) share the 10/min budget. After launch monitor the WARNING lines and 429 rate, and raise `RATE_LIMIT_PUBLIC_PER_MIN` if legitimate users are affected.
- A path parameter longer than 128 characters is answered 404 by the router before any hook runs (no database read, no oracle) and is not counted.
- The IP position in `X-Forwarded-For` is unverified live (ADR 0017); the limiter is only as good as that assumption.
- Replacing the adapter by a shared store (#427) needs no consumer change.
- The estimator is an approximation: an adversary who pads the start of one window and bursts at its end can get close to `2 * limit - 1` requests inside one `windowMs`, the same worst case as the classic sliding-window counter. Accepted for the goal (slowing ID enumeration; limits are per instance anyway, up to 3 instances). A request-log or finer-bucket algorithm would be needed for a hard bound.
