import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  PublicCertificateDto,
  PublicCertificateParamsDto,
  toPublicCertificateDto,
  type PublicUrls,
} from '../dto/public/certificate.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';
import type { Services } from '../../wiring.js';

/**
 * `GET /api/v1/public/certificates/{id}`: unauthenticated verification lookup. "Public access =
 * knowing the ID": the ID is validated by the service before the single read; malformed and
 * unknown IDs give the identical 404. Nothing personal is logged.
 *
 * Rate limit hook point: the public rate limit (BEU-ICT/certificate-manager#387) is not implemented yet; when it lands it
 * belongs in the `onRequest` hook of this scope, before the handler runs.
 */
export function publicCertificateRoutes(
  app: FastifyInstance,
  services: Services,
  urls: PublicUrls,
): void {
  void app.register((scope, _opts, done) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-cache').header('x-robots-tag', 'noindex, nofollow');
      done(null, payload);
    });
    r.get(
      '/api/v1/public/certificates/:id',
      {
        schema: {
          operationId: 'getPublicCertificate',
          summary: 'Verify a certificate by ID',
          description:
            'Public. A malformed and an unknown ID return the same 404. Revoked certificates keep their public fields with `status: "revoked"` and `pdfUrl: null`; the revocation reason and time are never public. Always revalidated (`Cache-Control: no-cache`).',
          params: PublicCertificateParamsDto,
          response: {
            200: jsonResponse('The certificate', PublicCertificateDto),
            ...errorResponses(404),
          },
        },
      },
      async (request) => {
        const certificate = await services.certificates.getPublic(request.params.id);
        return toPublicCertificateDto(certificate, urls);
      },
    );
    // Anything else below the collection (slashes, over-long segments) must answer exactly like an
    // unknown ID, not with the router's generic 404 body.
    scope.get<{ Params: { '*': string } }>(
      '/api/v1/public/certificates/*',
      { schema: { hide: true } },
      async (request) => services.certificates.getPublic(request.params['*']),
    );
    done();
  });
}
