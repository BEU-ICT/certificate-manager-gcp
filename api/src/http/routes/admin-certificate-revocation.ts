import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Services } from '../../wiring.js';
import { audit } from '../audit.js';
import { adminRoutes } from '../auth/admin-guard.js';
import {
  CertificateIdParamsDto,
  RevokeCertificateBodyDto,
  RevokedCertificateDto,
  toRevokedCertificateDto,
} from '../dto/admin/certificate-revocation.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];

/** `POST /api/v1/admin/certificates/:id/revoke`. */
export function adminCertificateRevocationRoutes(app: FastifyInstance, services: Services): void {
  const { revocation } = services;

  adminRoutes(app, (scope) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });

    r.post(
      '/certificates/:id/revoke',
      {
        schema: {
          operationId: 'revokeCertificate',
          summary: 'Revoke a certificate',
          description:
            'Idempotent. An active certificate becomes `revoked` (reason and time stored) and its PDF is deleted. Repeating the call returns the current state with `200`; the original reason is kept and a different `reason` is ignored. If the PDF could not be deleted the response is still `200` with `warnings: ["PDF_DELETE_FAILED"]`; repeating the call retries the deletion. There is no un-revoke: re-issue instead.',
          security: SECURITY,
          params: CertificateIdParamsDto,
          body: RevokeCertificateBodyDto,
          response: {
            200: jsonResponse('The revoked certificate', RevokedCertificateDto),
            ...errorResponses(400, 401, 403, 404),
          },
        },
      },
      async (request) => {
        const { certificate, newlyRevoked, warnings } = await revocation.revoke(
          request.params.id,
          request.body.reason,
        );
        if (newlyRevoked) audit(request, 'certificate.revoked', certificate.id);
        if (warnings.length > 0) {
          // Alert-worthy (BEU-ICT/certificate-manager#391): the object may still be reachable by whoever knows its URL.
          request.log.error(
            { certificateId: certificate.id, warnings },
            'PDF deletion failed after revocation',
          );
        }
        return toRevokedCertificateDto(certificate, warnings);
      },
    );
  });
}
