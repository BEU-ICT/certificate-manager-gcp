import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { AppError, type ErrorDetail } from '../shared/errors.js';

export interface ErrorBody {
  error: { code: string; message: string; details?: ErrorDetail[]; requestId: string };
}

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: ErrorDetail[],
  headers: Readonly<Record<string, string>> = {},
): FastifyReply {
  const error: ErrorBody['error'] = { code, message, requestId: request.id };
  if (details !== undefined) error.details = details;
  return reply
    .headers(headers)
    .status(status)
    .send({ error } satisfies ErrorBody);
}

/** `["items", 3, "email"]` -> `items[3].email` */
export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    const key = String(part);
    return acc === '' ? key : `${acc}.${key}`;
  }, '');
}

export function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
}

function isFastifyClientError(error: unknown): error is FastifyError {
  if (typeof error !== 'object' || error === null) return false;
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}

export function errorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof AppError) {
    request.log.warn({ code: error.code, status: error.statusCode }, 'request rejected');
    return send(
      request,
      reply,
      error.statusCode,
      error.code,
      error.message,
      error.details,
      error.headers,
    );
  }
  if (error instanceof ZodError) {
    request.log.warn({ code: 'VALIDATION_FAILED' }, 'request validation failed');
    return send(
      request,
      reply,
      400,
      'VALIDATION_FAILED',
      'Request validation failed',
      zodDetails(error),
    );
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    // Route-level zod schemas (params, query, body); see http/openapi.
    request.log.warn({ code: 'VALIDATION_FAILED' }, 'request validation failed');
    const details = error.validation.map((issue) => ({
      path: formatPath(
        issue.instancePath
          .split('/')
          .filter((part) => part !== '')
          .map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
      ),
      message: issue.message ?? 'Invalid value',
    }));
    return send(request, reply, 400, 'VALIDATION_FAILED', 'Request validation failed', details);
  }
  // FST_ERR_HANDLER_TIMEOUT is raised by Fastify 5.x for a route's handlerTimeout.
  if ((error as { code?: unknown } | null)?.code === 'FST_ERR_HANDLER_TIMEOUT') {
    // The route's handlerTimeout fired (e.g. a slow template upload): retryable.
    request.log.warn({ code: 'UNAVAILABLE', status: 503 }, 'request timed out');
    return send(request, reply, 503, 'UNAVAILABLE', 'The request took too long', undefined, {
      'retry-after': '5',
    });
  }
  if (isFastifyClientError(error)) {
    request.log.warn({ code: error.code, status: error.statusCode }, 'request rejected');
    if (error.statusCode === 413) {
      return send(request, reply, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    // Malformed JSON, unsupported media type, empty body, ...: fixed generic text,
    // the parser's own message could echo user input.
    return send(request, reply, 400, 'VALIDATION_FAILED', 'Request could not be parsed');
  }
  // Unknown error: full detail (including stack) goes to the log only.
  request.log.error({ err: error }, 'unhandled error');
  return send(request, reply, 500, 'INTERNAL', 'Internal server error');
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment === '*') return '.*';
      if (segment.startsWith(':')) return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${source}/?$`);
}

/**
 * Registers the error handler and the 404/405 handler. Must run on the root
 * instance before any route is registered: the route registry (used to tell
 * "wrong method" from "unknown path") is filled by an `onRoute` hook.
 */
export function installErrorHandling(app: FastifyInstance): void {
  const routes: { matcher: RegExp; method: string }[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const matcher = patternToRegExp(route.url);
    for (const method of methods) routes.push({ matcher, method: method.toUpperCase() });
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    const allowed = [
      ...new Set(routes.filter((r) => r.matcher.test(path)).map((r) => r.method)),
    ].sort();
    if (allowed.length > 0) {
      return send(request, reply, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', undefined, {
        allow: allowed.join(', '),
      });
    }
    return send(request, reply, 404, 'NOT_FOUND', 'Resource not found');
  });
}
