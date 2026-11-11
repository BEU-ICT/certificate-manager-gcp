import { describe, expect, it } from 'vitest';
import {
  DefaultPdfService,
  InMemoryRendererRegistry,
  RENDER_ENGINE_UNSUPPORTED,
  type FitResult,
  type RenderAssets,
  type RenderInput,
  type TemplateRenderer,
} from '../../src/modules/pdf/index.js';
import type { TemplateAssets } from '../../src/modules/templates/index.js';
import type { Certificate, Template } from '../../src/shared/domain.js';
import { NotFoundError, UnprocessableError } from '../../src/shared/errors.js';
import {
  asCertificateId,
  asEventId,
  asOrganizationId,
  asTemplateRef,
} from '../../src/shared/ids.js';

const REF = 'acme-devfest-attendance-v0';

function makeTemplate(config: Record<string, unknown>): Template {
  return {
    reference: asTemplateRef(REF),
    organizationId: asOrganizationId('org-1'),
    eventId: asEventId('ev-1'),
    organizationSlug: 'acme',
    eventSlug: 'devfest',
    type: 'attendance',
    version: 0,
    storagePath: `templates/${REF}/`,
    config,
    createdAt: new Date(0),
    createdBy: 'admin',
    schemaVersion: 1,
  };
}

function makeCertificate(): Certificate {
  return {
    id: asCertificateId('AbCdEfGhIjKlMnOpQrStUv'),
    organizationId: asOrganizationId('org-1'),
    eventId: asEventId('ev-1'),
    organizationName: 'Acme',
    eventName: 'DevFest',
    templateId: asTemplateRef(REF),
    type: 'attendance',
    ownerName: 'Ada Lovelace',
    email: 'ada@example.com',
    subject: 'DevFest 2026',
    skills: ['TypeScript'],
    status: 'active',
    issuedAt: new Date('2026-01-02T00:00:00Z'),
    emailStatus: 'pending',
    emailAttempts: 0,
    createdBy: 'admin',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    schemaVersion: 1,
  };
}

class StubAssets implements TemplateAssets {
  readonly loads: string[] = [];
  constructor(private readonly templates: Map<string, Template>) {}
  load(reference: string): Promise<RenderAssets> {
    this.loads.push(reference);
    const template = this.templates.get(reference);
    if (!template) return Promise.reject(new NotFoundError('Template not found'));
    return Promise.resolve({
      template,
      background: Buffer.from('bg'),
      fonts: new Map(),
      images: new Map(),
    });
  }
}

class DummyRenderer implements TemplateRenderer {
  readonly calls: { input: RenderInput; assets: RenderAssets }[] = [];
  constructor(readonly engine: string) {}
  render(input: RenderInput, assets: RenderAssets): Promise<Buffer> {
    this.calls.push({ input, assets });
    return Promise.resolve(Buffer.from(`pdf:${this.engine}:${input.ownerName}`));
  }
  checkFit(input: RenderInput): FitResult {
    return input.ownerName.length > 15
      ? { fits: false, issues: [{ field: 'ownerName', message: 'too long' }] }
      : { fits: true, issues: [] };
  }
}

function setup(config: Record<string, unknown> = { engine: 'dummy' }) {
  const template = makeTemplate(config);
  const registry = new InMemoryRendererRegistry();
  const dummy = new DummyRenderer('dummy');
  registry.register(dummy);
  const assets = new StubAssets(new Map([[REF, template]]));
  const service = new DefaultPdfService(registry, assets, (c) => `https://x.test/v/${c.id}`);
  return { template, registry, dummy, assets, service };
}

describe('InMemoryRendererRegistry', () => {
  it('returns a registered renderer by engine', () => {
    const { registry, dummy } = setup();
    expect(registry.get('dummy')).toBe(dummy);
  });

  it('rejects registering the same engine twice', () => {
    const { registry } = setup();
    expect(() => registry.register(new DummyRenderer('dummy'))).toThrow(/already registered/);
  });

  it('throws UnprocessableError RENDER_ENGINE_UNSUPPORTED for an unknown engine', () => {
    const { registry } = setup();
    let caught: unknown;
    try {
      registry.get('nope');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnprocessableError);
    const error = caught as UnprocessableError;
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe(RENDER_ENGINE_UNSUPPORTED);
    expect(error.details).toEqual([{ path: 'config.engine', message: RENDER_ENGINE_UNSUPPORTED }]);
    expect(error.message).not.toContain('nope');
  });
});

describe('DefaultPdfService', () => {
  it('renders through the engine named by config.engine with loaded assets', async () => {
    const { service, template, dummy, assets } = setup();
    const pdf = await service.render(makeCertificate(), template);
    expect(pdf.toString()).toBe('pdf:dummy:Ada Lovelace');
    expect(assets.loads).toEqual([REF]);
    expect(dummy.calls).toHaveLength(1);
    expect(dummy.calls[0]?.assets.background.toString()).toBe('bg');
  });

  it('passes render input without the e-mail address and with the public URL', async () => {
    const { service, template, dummy } = setup();
    await service.render(makeCertificate(), template);
    const input = dummy.calls[0]?.input;
    expect(input).toEqual({
      ownerName: 'Ada Lovelace',
      subject: 'DevFest 2026',
      skills: ['TypeScript'],
      issuedAt: new Date('2026-01-02T00:00:00Z'),
      organizationName: 'Acme',
      type: 'attendance',
      publicUrl: 'https://x.test/v/AbCdEfGhIjKlMnOpQrStUv',
    });
    expect(input).not.toHaveProperty('email');
  });

  it('delegates checkFit to the engine', async () => {
    const { service, template } = setup();
    expect((await service.checkFit(makeCertificate(), template)).fits).toBe(true);
    const long = { ...makeCertificate(), ownerName: 'A very long owner name' };
    const result = await service.checkFit(long, template);
    expect(result).toEqual({ fits: false, issues: [{ field: 'ownerName', message: 'too long' }] });
  });

  it('previews a stored template with sample data', async () => {
    const { service, dummy } = setup();
    const sample: RenderInput = {
      ownerName: 'Sample',
      subject: 'S',
      skills: [],
      issuedAt: new Date(0),
      type: 'attendance',
      publicUrl: 'https://x.test/v/SAMPLE',
    };
    expect((await service.preview(REF, sample)).toString()).toBe('pdf:dummy:Sample');
    expect(dummy.calls[0]?.input).toBe(sample);
  });

  it.each([[{ engine: 'unknown' }], [{}], [{ engine: 5 }]])(
    'fails with RENDER_ENGINE_UNSUPPORTED for config %j',
    async (config) => {
      const { service, template } = setup(config);
      await expect(service.render(makeCertificate(), template)).rejects.toMatchObject({
        statusCode: 422,
        code: RENDER_ENGINE_UNSUPPORTED,
      });
      await expect(service.checkFit(makeCertificate(), template)).rejects.toMatchObject({
        code: RENDER_ENGINE_UNSUPPORTED,
      });
    },
  );

  it('propagates NotFoundError for a missing template', async () => {
    const { service } = setup();
    const sample: RenderInput = {
      ownerName: 'Sample',
      subject: 'S',
      skills: [],
      issuedAt: new Date(0),
      type: 'attendance',
      publicUrl: 'https://x.test/v/SAMPLE',
    };
    await expect(service.preview('acme-devfest-attendance-v9', sample)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
