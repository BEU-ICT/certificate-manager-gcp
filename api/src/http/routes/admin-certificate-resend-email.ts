import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Services } from '../../wiring.js';
import { audit } from '../audit.js';
import { adminRoutes } from '../auth/admin-guard.js';
import { CertificateIdParamsDto } from '../dto/admin/certificate-revocation.js';
import { ResendEmailBodyDto, ResendEmailResultDto } from '../dto/admin/certificate.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];

/** `POST /api/v1/admin/certificates/:id/resend-email`. */
export function adminCertificateResendEmailRoutes(app: FastifyInstance, services: Services): void {
  const { emailResend } = services;

  adminRoutes(app, (scope) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });

    r.post(
      '/certificates/:id/resend-email',
      {
        schema: {
          operationId: 'resendCertificateEmail',
          summary: 'Resend the certificate e-mail',
          description:
            'Queues a new send (`202`). Allowed for `failed`, `sent` and `skipped` (a `skipped` certificate with a supplied address gets its first send); a `pending` e-mail blocks the call unless it has been pending for more than 2 hours. Optional `email` replaces the stored address (audit line `certificate.email_changed`, no addresses logged). Errors: 409 `CONFLICT` with detail `CERTIFICATE_REVOKED` or `EMAIL_IN_PROGRESS`, 422 `EMAIL_REQUIRED`, 429 `RATE_LIMITED` (at most 5 resends per certificate per 24 hours; refused attempts count; the counter is per instance with the in-process limiter), 503 `UNAVAILABLE` when the task queue refuses the task (the certificate is then `failed` with `ENQUEUE_FAILED`; retry).',
          security: SECURITY,
          params: CertificateIdParamsDto,
          body: ResendEmailBodyDto,
          response: {
            202: jsonResponse('The send was queued', ResendEmailResultDto),
            ...errorResponses(400, 401, 403, 404, 409, 422),
          },
        },
      },
      async (request, reply) => {
        const { email } = request.body;
        const result = await emailResend.resend(request.params.id, {
          ...(email !== undefined && { email }),
        });
        if (result.emailChanged) audit(request, 'certificate.email_changed', request.params.id);
        void reply.code(202);
        return { emailStatus: result.emailStatus, emailAttempts: result.emailAttempts };
      },
    );
  });
}
