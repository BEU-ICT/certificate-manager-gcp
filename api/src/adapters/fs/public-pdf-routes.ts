import type { FastifyInstance } from 'fastify';
import { FsStorageGateway, isSafeKey } from './storage-gateway.js';

/**
 * Local stand-in for the public PDF bucket: `GET|HEAD /pdfs/<key>` serves stored PDFs so that the
 * redirect of `/api/v1/public/certificates/:id/pdf` (to `PDF_PUBLIC_BASE_URL/pdfs/<key>`) works
 * when `PDF_PUBLIC_BASE_URL` points at this API. Read-only, no listing, `Cache-Control: no-cache`.
 */
export function registerFsPublicPdfRoutes(app: FastifyInstance, storage: FsStorageGateway): void {
  app.route({
    method: ['GET', 'HEAD'],
    url: '/pdfs/*',
    schema: { hide: true },
    handler: async (request, reply) => {
      const key = decodeURIComponent((request.params as { '*': string })['*']);
      const body = isSafeKey(key) ? await storage.get('pdfs', key) : null;
      if (body === null) return reply.code(404).send();
      return reply
        .header('content-type', 'application/pdf')
        .header('cache-control', 'no-cache')
        .header('x-content-type-options', 'nosniff')
        .send(body);
    },
  });
}
