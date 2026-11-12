import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { RateLimiter, TaskRequestVerifier } from '../../ports/index.js';
import { SEND_EMAIL_HANDLER, sendEmailTaskSchema } from '../../shared/email-task.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import { getClientIp } from '../client-ip.js';
import { hashKeyPart } from '../rate-limit/index.js';
import type { SendEmailRequest, SendEmailOutcome } from '../../modules/notifications/index.js';

/**
 * Route-level flood guard. `/internal/**` is also limited at the edge (http/rate-limit, 120/min per
 * IP, stricter) when `publicRateLimitPerMin` is configured; this one stays because it works
 * without that option and is covered by this route's tests. The queue dispatches about 1 task/s.
 */
export const INTERNAL_TASKS_PER_MIN = 600;
const WINDOW_MS = 60_000;

export interface InternalSendEmailDeps {
  verifier: TaskRequestVerifier;
  rateLimiter: RateLimiter;
  handle: (request: SendEmailRequest) => Promise<SendEmailOutcome>;
  perMinute?: number;
  now?: () => number;
}

/** `X-CloudTasks-TaskRetryCount`: 0 for the first attempt; anything unparsable counts as 0. */
function retryCountOf(header: string | string[] | undefined): number {
  const value = typeof header === 'string' ? Number(header) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * `POST /internal/tasks/send-email` (BEU-ICT/certificate-manager#368): called by Cloud Tasks only.
 * Not under `/api/v1`, hidden from OpenAPI, not behind the admin guard and not counted by the
 * public rate limiter; it has its own per-IP limiter. The task credential is verified in
 * `onRequest`, before the body is parsed and before any database access. Responses are empty:
 * 200 done, 401 bad credential, 400 invalid body, 429 flood, 500 retry.
 */
export function internalSendEmailRoutes(app: FastifyInstance, deps: InternalSendEmailDeps): void {
  const now = deps.now ?? Date.now;
  void app.register((scope, _opts, done) => {
    scope.addHook('onRequest', async (request, reply) => {
      const result = await deps.rateLimiter.consume(
        `internal-tasks:ip:${hashKeyPart(getClientIp(request))}`,
        { limit: deps.perMinute ?? INTERNAL_TASKS_PER_MIN, windowMs: WINDOW_MS },
      );
      if (!result.allowed) {
        const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - now()) / 1000));
        request.log.warn({ route: SEND_EMAIL_HANDLER }, 'internal task rate limited');
        return reply.code(429).header('retry-after', String(retryAfter)).send();
      }
      try {
        await deps.verifier.verify(request.headers.authorization);
      } catch (error) {
        if (!(error instanceof UnauthenticatedError)) throw error;
        request.log.warn({ route: SEND_EMAIL_HANDLER }, 'internal task authentication failed');
        return reply.code(401).header('www-authenticate', 'Bearer').send();
      }
      return undefined;
    });

    scope
      .withTypeProvider<ZodTypeProvider>()
      .post(
        SEND_EMAIL_HANDLER,
        { schema: { hide: true, body: sendEmailTaskSchema } },
        async (request, reply) => {
          const outcome = await deps.handle({
            ...request.body,
            retryCount: retryCountOf(request.headers['x-cloudtasks-taskretrycount']),
          });
          return reply.code(outcome === 'done' ? 200 : 500).send();
        },
      );
    done();
  });
}
