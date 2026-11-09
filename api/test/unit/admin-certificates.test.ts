import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { openApiDocument } from '../../src/http/openapi/plugin.js';
import { buildServices } from '../../src/services.js';
import { describeCertificatesApi } from '../helpers/certificates-api-suite.js';
import { createFakes } from '../../src/testing/fakes/index.js';

describeCertificatesApi('in-memory fakes', () => createFakes());

describe('admin certificates OpenAPI', () => {
  it('documents list, count and detail; the summary schema has no email or pdfPath', async () => {
    const fakes = createFakes();
    const app = buildApp({ ports: fakes, services: buildServices(fakes) });
    await app.ready();
    const doc = openApiDocument(app) as unknown as {
      paths: Record<string, Record<string, { operationId: string; security: unknown }>>;
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    await app.close();
    expect(doc.paths['/api/v1/admin/certificates']?.['get']?.operationId).toBe('listCertificates');
    expect(doc.paths['/api/v1/admin/certificates/count']?.['get']?.operationId).toBe(
      'countCertificates',
    );
    expect(doc.paths['/api/v1/admin/certificates/{id}']?.['get']?.operationId).toBe(
      'getCertificate',
    );
    const summary = Object.keys(doc.components.schemas['AdminCertificateSummary']!.properties);
    expect(summary).toContain('hasEmail');
    expect(summary).not.toContain('email');
    expect(Object.keys(doc.components.schemas['AdminCertificate']!.properties)).not.toContain(
      'pdfPath',
    );
  });
});
