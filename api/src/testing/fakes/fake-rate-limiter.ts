import { InProcessRateLimiter } from '../../adapters/in-process/rate-limiter.js';

/**
 * Sliding-window fake: the in-process adapter itself (src/testing may import adapters), so fake and
 * production semantics cannot drift. Tests pass its `close()` through the app's `onClose` hook.
 */
export class FakeRateLimiter extends InProcessRateLimiter {}
