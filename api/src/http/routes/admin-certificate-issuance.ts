import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Certificate } from '../../shared/domain.js';
import type { Services } from '../../wiring.js';
import { audit } from '../audit.js';
import { adminRoutes } from '../auth/admin-guard.js';
import {
  AdminCertificateDto,
  toAdminCertificateDto,
  type CertificateUrls,
} from '../dto/admin/certificate.js';
import { issueCertificateBodyDto, type IssuedMarker } from '../dto/admin/certificate-issuance.js';
import { IdempotencyKeyHeaderDto, withIdempotency } from '../idempotency.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];

function isMarker(payload: unknown): payload is IssuedMarker {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Object.keys(payload).length === 1 &&
    typeof (payload as { certificateId?: unknown }).certificateId === 'string'
  );
}

/**
 * `POST /api/v1/admin/certificates`: single issuance. Registered only when `services.issuance`
 * exists. The idempotency record stores the certificate ID only; the response body (the admin
 * DTO, with personal data) is built on the way out, from the just-created certificate or, for a
 * replay, by reading it back.
 */
export function adminCertificateIssuanceRoutes(
  app: FastifyInstance,
  services: Services,
  urls: CertificateUrls,
): void {
  const { issuance, certificateQueries } = services;
  if (!issuance) return;
  const created = new WeakMap<FastifyRequest, Certificate>();

  adminRoutes(app, (scope) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });
    r.addHook('preSerialization', async (request, reply, payload) => {
      if (reply.statusCode !== 201 || !isMarker(payload)) return payload;
      // Replay edge case: the certificate may have been revoked since (still returned) or be gone (404).
      const certificate =
        created.get(request) ?? (await certificateQueries.get(payload.certificateId));
      return toAdminCertificateDto(certificate, urls);
    });

    r.post(
      '/certificates',
      {
        schema: {
          operationId: 'issueCertificate',
          summary: 'Issue one certificate',
          description:
            'Validates the references, checks that the texts fit the template, stores the certificate (`status: active`; `emailStatus` is `pending` with an e-mail address, `skipped` without) and publishes `certificate.issued`. Without `templateId` the latest template version for the organization, event and type is used. Errors: 422 `EVENT_ORG_MISMATCH`, `TEMPLATE_MISMATCH` (details name the fields), `TEMPLATE_NOT_FOUND`, `TEXT_DOES_NOT_FIT` (details list every failing field); nothing is stored in these cases.',
          security: SECURITY,
          headers: IdempotencyKeyHeaderDto,
          body: issueCertificateBodyDto(() => issuance.now()),
          response: {
            201: jsonResponse('The issued certificate', AdminCertificateDto),
            ...errorResponses(400, 401, 403, 404, 409, 422),
          },
        },
      },
      // withIdempotency sends the reply itself and returns it; the response body is typed by the
      // schema (built in preSerialization), so the handler type is widened here.
      withIdempotency(services.idempotency, async (request) => {
        const body = request.body as Parameters<typeof issuance.issue>[0] & {
          skills?: string[] | undefined;
        };
        const adminUid = request.admin?.uid;
        if (adminUid === undefined) throw new Error('Admin identity missing on an admin route');
        const certificate = await issuance.issue({ ...body, skills: body.skills ?? [] }, adminUid);
        audit(request, 'certificate.issued', certificate.id, {
          organizationId: certificate.organizationId,
          eventId: certificate.eventId,
        });
        created.set(request, certificate);
        const marker: IssuedMarker = { certificateId: certificate.id };
        return { status: 201, body: marker };
      }) as unknown as () => Promise<never>,
    );
  });
}
