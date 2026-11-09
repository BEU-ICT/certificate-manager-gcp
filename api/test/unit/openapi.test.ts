import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../src/app.js';
import { openApiDocument } from '../../src/http/openapi/plugin.js';
import { errorResponses, jsonResponse } from '../../src/http/openapi/responses.js';
import { createFakes } from '../../src/testing/fakes/index.js';

const committedPath = fileURLToPath(new URL('../../openapi.json', import.meta.url));

async function liveSpec(): Promise<ReturnType<typeof openApiDocument>> {
  const app = buildApp({ ports: createFakes() });
  await app.ready();
  const doc = openApiDocument(app);
  await app.close();
  return doc;
}

interface Operation {
  responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
}

describe('OpenAPI document', () => {
  it('matches the committed api/openapi.json (run `npm run openapi:generate` after route changes)', async () => {
    const committed: unknown = JSON.parse(readFileSync(committedPath, 'utf8'));
    expect(await liveSpec()).toEqual(committed);
  });

  it('is OpenAPI 3.1 and documents the health and admin routes', async () => {
    const doc = await liveSpec();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths ?? {})).toEqual([
      '/api/v1/admin/certificates',
      '/api/v1/admin/certificates/count',
      '/api/v1/admin/certificates/{id}',
      '/api/v1/admin/certificates/{id}/revoke',
      '/api/v1/admin/events',
      '/api/v1/admin/events/{id}',
      '/api/v1/admin/me',
      '/api/v1/admin/organizations',
      '/api/v1/admin/organizations/{id}',
      '/api/v1/admin/stats',
      '/api/v1/admin/templates',
      '/api/v1/admin/templates/{reference}',
      '/api/v1/public/certificates/{id}',
      '/internal/healthz',
    ]);
  });

  it('describes the template upload as multipart/form-data with the TEMPLATE_INVALID details', async () => {
    const doc = await liveSpec();
    const post = (doc.paths?.['/api/v1/admin/templates'] as Record<string, unknown>)['post'] as {
      requestBody: { content: Record<string, { schema: { $ref?: string } }> };
      responses: Record<string, unknown>;
    };
    expect(Object.keys(post.requestBody.content)).toEqual(['multipart/form-data']);
    const schemas = doc.components?.schemas as Record<string, Record<string, unknown>>;
    expect(post.requestBody.content['multipart/form-data']?.schema.$ref).toBe(
      '#/components/schemas/TemplateUploadBodyInput',
    );
    expect(schemas['TemplateUploadBodyInput']).toMatchObject({
      required: ['organizationId', 'eventId', 'type', 'config'],
      additionalProperties: { type: 'string', format: 'binary' },
    });
    for (const status of ['201', '400', '401', '403', '404', '413', '422']) {
      expect(post.responses).toHaveProperty(status);
    }
    expect(Object.keys((schemas['ErrorDetail'] as { properties: object }).properties)).toEqual(
      expect.arrayContaining(['path', 'message', 'code', 'file']),
    );
  });

  it('documents every error response with the shared ErrorBody schema', async () => {
    const doc = await liveSpec();
    let errorResponseCount = 0;
    for (const item of Object.values(doc.paths ?? {})) {
      for (const op of Object.values(item as Record<string, Operation>)) {
        for (const [status, response] of Object.entries(op.responses)) {
          if (Number(status) < 400) continue;
          errorResponseCount++;
          expect(response.content?.['application/json']?.schema?.$ref).toBe(
            '#/components/schemas/ErrorBody',
          );
        }
      }
    }
    expect(errorResponseCount).toBeGreaterThan(0);
  });
});

describe('GET /internal/openapi.json', () => {
  it('serves the live document when the endpoint is enabled', async () => {
    const app = buildApp({ openApiEndpoint: true, ports: createFakes() });
    const res = await app.inject({ method: 'GET', url: '/internal/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual(JSON.parse(readFileSync(committedPath, 'utf8')));
    await app.close();
  });

  it('is not registered (404) when the endpoint is disabled', async () => {
    const app = buildApp({ openApiEndpoint: false });
    const res = await app.inject({ method: 'GET', url: '/internal/openapi.json' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await app.close();
  });

  it('is off by default', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/internal/openapi.json' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('route-level zod schemas', () => {
  function withRoute(register: (app: FastifyInstance) => void): FastifyInstance {
    const app = buildApp();
    register(app);
    return app;
  }

  it('maps a request validation failure to the shared error format', async () => {
    const app = withRoute((a) => {
      a.after(() => {
        a.withTypeProvider<ZodTypeProvider>().get(
          '/t',
          {
            schema: {
              querystring: z.object({ limit: z.coerce.number().int().min(1) }),
              response: {
                200: jsonResponse('ok', z.object({ n: z.number() })),
                ...errorResponses(400),
              },
            },
          },
          (req) => ({ n: req.query.limit }),
        );
      });
    });
    const bad = await app.inject({ method: 'GET', url: '/t?limit=0' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: [{ path: 'limit' }],
      },
    });
    const ok = await app.inject({ method: 'GET', url: '/t?limit=3' });
    expect(ok.json()).toEqual({ n: 3 });
    await app.close();
  });

  it('turns a response that does not match its schema into a generic 500', async () => {
    const app = withRoute((a) => {
      a.after(() => {
        a.withTypeProvider<ZodTypeProvider>().get(
          '/leak',
          { schema: { response: { 200: jsonResponse('ok', z.object({ n: z.number() })) } } },
          () => ({ n: 'not a number' }) as unknown as { n: number },
        );
      });
    });
    const res = await app.inject({ method: 'GET', url: '/leak' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: 'INTERNAL' } });
    await app.close();
  });

  it('strips fields that are not in the response schema (DTO whitelist)', async () => {
    const app = withRoute((a) => {
      a.after(() => {
        a.withTypeProvider<ZodTypeProvider>().get(
          '/strip',
          { schema: { response: { 200: jsonResponse('ok', z.object({ id: z.string() })) } } },
          () => ({ id: 'a', email: 'x@example.org' }) as { id: string },
        );
      });
    });
    const res = await app.inject({ method: 'GET', url: '/strip' });
    expect(res.json()).toEqual({ id: 'a' });
    await app.close();
  });
});
