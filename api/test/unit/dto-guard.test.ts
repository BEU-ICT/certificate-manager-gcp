import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../src/app.js';
import { FORBIDDEN_PUBLIC_FIELDS, findForbiddenFields } from '../../src/http/dto/guard.js';
import { openApiDocument } from '../../src/http/openapi/plugin.js';

const dtoDir = new URL('../../src/http/dto/', import.meta.url);
const publicDir = new URL('public/', dtoDir);

describe('DTO whitelist guard', () => {
  it('forbids the agreed fields', () => {
    expect([...FORBIDDEN_PUBLIC_FIELDS].sort()).toEqual(
      ['createdBy', 'email', 'pdfPath', 'revokeReason'].sort(),
    );
  });

  it('detects forbidden properties at any depth, case-insensitively', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        owner: { type: 'object', properties: { Email: { type: 'string' } } },
        files: { type: 'array', items: { properties: { pdfPath: { type: 'string' } } } },
      },
    };
    expect(findForbiddenFields(schema)).toEqual([
      '#/properties/owner/properties/Email',
      '#/properties/files/items/properties/pdfPath',
    ]);
    expect(
      findForbiddenFields({ properties: { email: {}, createdBy: {}, revokeReason: {} } }),
    ).toHaveLength(3);
  });

  it('ignores values that merely contain a forbidden word', () => {
    expect(
      findForbiddenFields({ properties: { emailVerified: {}, description: { example: 'email' } } }),
    ).toEqual([]);
  });

  it('no exported schema in src/http/dto/public/ contains a forbidden field', async () => {
    const files = readdirSync(publicDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const mod = (await import(new URL(file, publicDir).href)) as Record<string, unknown>;
      for (const [name, value] of Object.entries(mod)) {
        if (!(value instanceof z.ZodType)) continue;
        const json = z.toJSONSchema(value, { unrepresentable: 'any' });
        expect(findForbiddenFields(json), `${file}#${name}`).toEqual([]);
      }
    }
  });

  it('the generated OpenAPI document contains no forbidden field', async () => {
    const app = buildApp();
    await app.ready();
    // Admin DTOs (src/http/dto/admin, ids `Admin*`) legitimately carry the administrator's own e-mail.
    const doc = openApiDocument(app) as unknown as {
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };
    const publicDoc = {
      ...doc,
      paths: Object.fromEntries(
        Object.entries(doc.paths).filter(([path]) => !path.startsWith('/api/v1/admin')),
      ),
      components: {
        ...doc.components,
        schemas: Object.fromEntries(
          Object.entries(doc.components?.schemas ?? {}).filter(
            ([name]) => !name.startsWith('Admin'),
          ),
        ),
      },
    };
    expect(findForbiddenFields(publicDoc)).toEqual([]);
    await app.close();
  });

  it('DTO mappers never spread an entity (explicit field whitelists only)', () => {
    const offenders: string[] = [];
    const walk = (dir: URL): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
        if (entry.isDirectory()) walk(url);
        else if (
          entry.name.endsWith('.ts') &&
          entry.name !== 'guard.ts' &&
          /\.\.\.\s*[\w$]/.test(readFileSync(url, 'utf8'))
        ) {
          offenders.push(fileURLToPath(url));
        }
      }
    };
    walk(dtoDir);
    expect(offenders).toEqual([]);
  });
});
