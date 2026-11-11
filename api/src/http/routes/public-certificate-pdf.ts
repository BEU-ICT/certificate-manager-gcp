import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PublicCertificateParamsDto, type PublicUrls } from '../dto/public/certificate.js';
import { assertFlagEnabled } from '../flag-guard.js';
import { errorResponses } from '../openapi/responses.js';
import { createFeatureFlags, parseFlags, type FeatureFlags } from '../../flags.js';
import type { Services } from '../../wiring.js';

/**
 * `GET /api/v1/public/certificates/{id}/pdf`: unauthenticated, generates the PDF on first use and
 * redirects (302) to the public bucket object. Malformed and unknown IDs give the identical 404;
 * revoked certificates 410. Nothing personal is logged.
 */
export function publicCertificatePdfRoutes(
  app: FastifyInstance,
  services: Services,
  urls: PublicUrls,
  flags: FeatureFlags = createFeatureFlags(parseFlags({}, true).flags),
): void {
  void app.register((scope, _opts, done) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('x-robots-tag', 'noindex, nofollow');
      done(null, payload);
    });
    r.get(
      '/api/v1/public/certificates/:id/pdf',
      {
        schema: {
          operationId: 'getPublicCertificatePdf',
          summary: 'Open the PDF of a certificate',
          description:
            'Public. Generates the PDF on first use (single-flight per certificate) and redirects with `302` to the public bucket object; later calls redirect without rendering. A malformed and an unknown ID return the same 404; revoked certificates return 410. While `FEATURE_PUBLIC_PDF_GENERATION` is off, certificates without a PDF answer 503; existing PDFs still redirect. Storage or database outages answer 503 with `Retry-After: 5`. Never cached (`Cache-Control: no-store`).',
          params: PublicCertificateParamsDto,
          response: {
            302: {
              description: 'Redirect to the PDF object (`Location`)',
              headers: {
                type: 'object',
                properties: {
                  Location: { type: 'string', description: 'Public URL of the PDF object' },
                },
              },
              content: {
                'text/plain': { schema: z.custom<string>().meta({ type: 'string', maxLength: 0 }) },
              },
            },
            ...errorResponses(404, 410),
          },
        },
      },
      async (request, reply) => {
        const { pdfPath } = await services.publicPdf.ensurePdf(request.params.id, {
          assertCanGenerate: () => {
            assertFlagEnabled(flags, 'publicPdfGeneration');
          },
        });
        const base = urls.pdfPublicBaseUrl.replace(/\/+$/, '');
        return reply.header('cache-control', 'no-store').redirect(`${base}/pdfs/${pdfPath}`, 302);
      },
    );
    done();
  });
}
