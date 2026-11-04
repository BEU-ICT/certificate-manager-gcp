import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { OpenAPIV3_1 } from 'openapi-types';

/**
 * Wires zod validation/serialization and the OpenAPI generator. Must run on the root instance
 * before any route is registered (swagger collects routes through an `onRoute` hook).
 */
export function installOpenApi(app: FastifyInstance): void {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  void app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Certificate Manager API',
        version: '1.0.0',
        description:
          'Generated from the zod route schemas (api/openapi.json, `npm run openapi:generate`).',
      },
    },
    transform: jsonSchemaTransform,
    transformObject: (document) => pruneUnusedSchemas(jsonSchemaTransformObject(document)),
  });
}

type Json = Record<string, unknown>;

function collectRefs(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into);
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const m = /^#\/components\/schemas\/(.+)$/.exec(value);
        if (m?.[1] !== undefined) into.add(m[1]);
      } else {
        collectRefs(value, into);
      }
    }
  }
}

/**
 * The type provider emits an input and an output variant (`XInput`, `X`) of every registered
 * schema. Keep only the schemas that are reachable from a path, so the document lists what
 * the API really uses and unused variants do not show up as spurious diffs.
 */
function pruneUnusedSchemas<T extends object>(document: T): T {
  const doc = document as Json;
  const components = doc['components'] as Json | undefined;
  const schemas = components?.['schemas'] as Json | undefined;
  if (components === undefined || schemas === undefined) return document;
  const used = new Set<string>();
  collectRefs({ ...doc, components: { ...components, schemas: undefined } }, used);
  const queue = [...used];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const before = new Set(used);
    collectRefs(schemas[name], used);
    for (const n of used) if (!before.has(n)) queue.push(n);
  }
  const kept = Object.fromEntries(Object.entries(schemas).filter(([name]) => used.has(name)));
  return { ...document, components: { ...components, schemas: kept } };
}

/** Recursively sorts object keys so the serialized document is deterministic. Arrays keep order. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** The OpenAPI document of a ready app, with deterministic key order. */
export function openApiDocument(app: FastifyInstance): OpenAPIV3_1.Document {
  return sortKeys(app.swagger()) as OpenAPIV3_1.Document;
}

/**
 * `GET /internal/openapi.json`. Registered only when the OpenAPI endpoint flag is on
 * (config.openApiEndpoint: on outside production, or FEATURE_OPENAPI_ENDPOINT=true).
 */
export function registerOpenApiEndpoint(app: FastifyInstance): void {
  app.get('/internal/openapi.json', { schema: { hide: true } }, () => openApiDocument(app));
}
