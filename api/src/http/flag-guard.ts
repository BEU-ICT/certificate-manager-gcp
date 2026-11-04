import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FeatureFlags, FlagName } from '../flags.js';
import { NotFoundError, UnavailableError } from '../shared/errors.js';

/** Throws an AppError when the flag is off: 404 (hidden), or 503 UNAVAILABLE for kill switches. */
export function assertFlagEnabled(flags: FeatureFlags, name: FlagName): void {
  if (flags.isEnabled(name)) return;
  if (flags.isKillSwitch(name)) {
    throw new UnavailableError(60, 'This feature is temporarily disabled');
  }
  throw new NotFoundError();
}

/**
 * Route guard for feature-flagged endpoints, used as an `onRequest`/`preHandler` hook:
 * `app.post('/x', { onRequest: requireFlag(flags, 'bulkIssuance') }, handler)`.
 */
export function requireFlag(
  flags: FeatureFlags,
  name: FlagName,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return () => {
    assertFlagEnabled(flags, name);
    return Promise.resolve();
  };
}
