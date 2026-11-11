import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createFeatureFlags, parseFlags, type FeatureFlags } from '../../flags.js';
import type { Certificate } from '../../shared/domain.js';
import type { Services } from '../../wiring.js';
import { audit } from '../audit.js';
import { adminRoutes } from '../auth/admin-guard.js';
import {
  BulkIssuedDto,
  bulkIssueBodyDto,
  type BulkIssuedMarker,
} from '../dto/admin/certificate-bulk-issuance.js';
import { requireFlag } from '../flag-guard.js';
import { IdempotencyKeyHeaderDto, withIdempotency } from '../idempotency.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];
const BODY_LIMIT_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 55_000;

function isMarker(payload: unknown): payload is BulkIssuedMarker {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Object.keys(payload).length === 1 &&
    Array.isArray((payload as { certificateIds?: unknown }).certificateIds)
  );
}

/**
 * `POST /api/v1/admin/certificates/bulk`: all-or-nothing issuance of up to 500 certificates.
 * Registered only when `services.issuance` exists; answers 404 while `FEATURE_BULK_ISSUANCE` is
 * off. The idempotency record stores the ordered certificate IDs only; the response (`id`,
 * `ownerName`, `hasEmail`) is built on the way out from the created certificates or, for a replay,
 * by reading them back in chunks (`CertificateQueryService.getMany`).
 */
export function adminCertificateBulkIssuanceRoutes(
  app: FastifyInstance,
  services: Services,
  flags: FeatureFlags = createFeatureFlags(parseFlags({}, true).flags),
): void {
  const { issuance, certificateQueries } = services;
  if (!issuance) return;
  const created = new WeakMap<FastifyRequest, readonly Certificate[]>();

  adminRoutes(app, (scope) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });
    r.addHook('preSerialization', async (request, reply, payload) => {
      if (reply.statusCode !== 201 || !isMarker(payload)) return payload;
      const certificates =
        created.get(request) ?? (await certificateQueries.getMany(payload.certificateIds));
      return {
        created: certificates.length,
        items: certificates.map((c) => ({
          id: c.id,
          ownerName: c.ownerName,
          hasEmail: c.email !== undefined,
        })),
      };
    });

    r.post(
      '/certificates/bulk',
      {
        onRequest: requireFlag(flags, 'bulkIssuance'),
        bodyLimit: BODY_LIMIT_BYTES,
        handlerTimeout: REQUEST_TIMEOUT_MS,
        schema: {
          operationId: 'issueCertificatesBulk',
          summary: 'Issue up to 500 certificates at once',
          description:
            'All or nothing. Resolves the template once, validates (strict per-item schema, same normalisation as single issuance) and fit-checks every item, then stores all certificates in one atomic batch and publishes `certificate.issued` per certificate in request order. `1 <= items.length <= 500`, otherwise 400 `VALIDATION_FAILED`. A per-item `subject` overrides the common `subject`; every item needs one. 422 `BULK_INVALID` lists all item problems as `details[{ path: "items[17].ownerName", message, code }]`, at most 200; `error.truncated: true` marks that more exist; nothing is stored. Reference errors (`EVENT_ORG_MISMATCH`, `TEMPLATE_MISMATCH`, `TEMPLATE_NOT_FOUND`) are 422 as in single issuance. Counts as one request for rate limiting. Body limit 1 MB, timeout 55 s. 404 while the `bulkIssuance` feature is off. Supports `Idempotency-Key`: a replay returns the same `items` with `Idempotent-Replayed: true`. The response contains no e-mail addresses.',
          security: SECURITY,
          headers: IdempotencyKeyHeaderDto,
          body: bulkIssueBodyDto(),
          response: {
            201: jsonResponse('The created certificates, in request order', BulkIssuedDto),
            ...errorResponses(400, 401, 403, 404, 409, 413, 422),
          },
        },
      },
      // withIdempotency sends the reply itself and returns it; the response body is typed by the
      // schema (built in preSerialization), so the handler type is widened here.
      withIdempotency(services.idempotency, async (request) => {
        const body = request.body as Parameters<typeof issuance.issueMany>[0];
        const adminUid = request.admin?.uid;
        if (adminUid === undefined) throw new Error('Admin identity missing on an admin route');
        const certificates = await issuance.issueMany(body, adminUid);
        const first = certificates[0];
        audit(request, 'certificate.bulk_issued', first?.eventId ?? body.eventId, {
          count: certificates.length,
          organizationId: body.organizationId,
          eventId: body.eventId,
          template: first?.templateId ?? '',
        });
        created.set(request, certificates);
        const marker: BulkIssuedMarker = { certificateIds: certificates.map((c) => c.id) };
        return { status: 201, body: marker };
      }) as unknown as () => Promise<never>,
    );
  });
}
