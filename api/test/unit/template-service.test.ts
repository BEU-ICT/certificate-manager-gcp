import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTemplateReference,
  templateAssetKey,
  templateBackgroundKey,
  templateConfigKey,
  templateFontKey,
  templateKey,
  type PublishTemplateInput,
  type TemplateConfig,
} from '../../src/modules/templates/index.js';
import { buildServices } from '../../src/services.js';
import {
  ConflictError,
  InUseError,
  NotFoundError,
  ValidationError,
} from '../../src/shared/errors.js';
import { createFakes } from '../../src/testing/fakes/create-fakes.js';

const config = { page: 'A4', locale: 'az' } as unknown as TemplateConfig;
const files = [
  { path: 'background.svg', body: Buffer.from('<svg/>') },
  { path: 'fonts/main.ttf', body: Buffer.from('ttf') },
  { path: 'assets/logo.png', body: Buffer.from('png') },
];

async function setup() {
  const fakes = createFakes();
  const services = buildServices(fakes);
  const org = await services.organizations.create({ name: 'Acme', slug: 'acme' });
  const event = await services.events.create({
    organizationId: org.id,
    name: 'DevFest',
    slug: 'devfest',
  });
  const input: PublishTemplateInput = {
    organizationId: org.id,
    eventId: event.id,
    organizationSlug: 'acme',
    eventSlug: 'devfest',
    type: 'attendance',
    config,
    files,
    createdBy: 'admin-1',
  };
  return { fakes, services, org, event, input, storage: fakes.storage };
}

describe('template references', () => {
  it('builds acme-devfest-attendance-v0', () => {
    expect(buildTemplateReference('acme', 'devfest', 'attendance', 0)).toBe(
      'acme-devfest-attendance-v0',
    );
    expect(buildTemplateReference('acme', 'devfest', 'attendance', 12)).toBe(
      'acme-devfest-attendance-v12',
    );
  });

  it.each([
    ['Acme', 'devfest', 'attendance', 0],
    ['acme', 'dev_fest', 'attendance', 0],
    ['acme', 'devfest', 'nope', 0],
    ['acme', 'devfest', 'attendance', -1],
    ['acme', 'devfest', 'attendance', 1.5],
    ['acme--x', 'devfest', 'attendance', 0],
    ['a', 'devfest', 'attendance', 0],
    ['x'.repeat(41), 'devfest', 'attendance', 0],
  ])('rejects %s / %s / %s / v%s', (org, event, type, version) => {
    expect(() => buildTemplateReference(org, event, type, version)).toThrow(ValidationError);
  });
});

describe('storage keys', () => {
  it('builds keys under templates/<reference>/', () => {
    const ref = 'acme-devfest-attendance-v0';
    expect(templateConfigKey(ref)).toBe(`templates/${ref}/config.json`);
    expect(templateBackgroundKey(ref)).toBe(`templates/${ref}/background.svg`);
    expect(templateFontKey(ref, 'main.ttf')).toBe(`templates/${ref}/fonts/main.ttf`);
    expect(templateAssetKey(ref, 'logo.png')).toBe(`templates/${ref}/assets/logo.png`);
    expect(templateKey(ref, 'fonts/a.ttf')).toBe(`templates/${ref}/fonts/a.ttf`);
  });

  it.each(['../x.ttf', 'a/b.ttf', '', '.', '..', 'a b.ttf', '/abs'])('rejects file %j', (file) => {
    expect(() => templateFontKey('a-v0', file)).toThrow(ValidationError);
    expect(() => templateAssetKey('a-v0', file)).toThrow(ValidationError);
  });

  it('rejects invalid references and paths', () => {
    expect(() => templateConfigKey('../evil')).toThrow(ValidationError);
    expect(() => templateConfigKey('Acme-v1')).toThrow(ValidationError);
    expect(() => templateConfigKey(`${'a'.repeat(120)}-v1`)).toThrow(ValidationError);
    expect(() => templateKey('a-v0', '../x')).toThrow(ValidationError);
  });
});

describe('TemplateService.publish', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('stores files in the templates bucket, then the document; versions count up', async () => {
    const first = await ctx.services.templates.publish(ctx.input);
    expect(first).toMatchObject({
      reference: 'acme-devfest-attendance-v0',
      version: 0,
      storagePath: 'templates/acme-devfest-attendance-v0/',
      createdBy: 'admin-1',
      schemaVersion: 1,
    });
    const second = await ctx.services.templates.publish(ctx.input);
    expect(second.reference).toBe('acme-devfest-attendance-v1');
    const keys = await ctx.storage.list('templates', 'templates/acme-devfest-attendance-v0/');
    expect(keys).toEqual([
      'templates/acme-devfest-attendance-v0/assets/logo.png',
      'templates/acme-devfest-attendance-v0/background.svg',
      'templates/acme-devfest-attendance-v0/config.json',
      'templates/acme-devfest-attendance-v0/fonts/main.ttf',
    ]);
    const stored = await ctx.storage.get('templates', keys[2] as string);
    expect(JSON.parse((stored as Buffer).toString())).toEqual(first.config);
    expect(await ctx.fakes.templates.getByReference(first.reference)).toEqual(first);
    expect(
      (await ctx.services.templates.getLatest(ctx.org.id, ctx.event.id, 'attendance'))?.version,
    ).toBe(1);
  });

  it('gives concurrent callers v0 and v1 without overwriting files', async () => {
    const [a, b] = await Promise.all([
      ctx.services.templates.publish({ ...ctx.input, createdBy: 'a' }),
      ctx.services.templates.publish({ ...ctx.input, createdBy: 'b' }),
    ]);
    expect([a.reference, b.reference].sort()).toEqual([
      'acme-devfest-attendance-v0',
      'acme-devfest-attendance-v1',
    ]);
    expect(await ctx.fakes.templates.count()).toBe(2);
    for (const t of [a, b]) {
      expect((await ctx.fakes.templates.getByReference(t.reference))?.createdBy).toBe(t.createdBy);
    }
  });

  it('gives up with ConflictError after the retries', async () => {
    // Every number up to v4 is claimed in storage by other (unfinished) uploads.
    for (let v = 0; v < 5; v++) {
      await ctx.storage.put(
        'templates',
        templateConfigKey(`acme-devfest-attendance-v${String(v)}`),
        Buffer.from('{}'),
        { contentType: 'application/json' },
      );
    }
    await expect(ctx.services.templates.publish(ctx.input)).rejects.toBeInstanceOf(ConflictError);
    expect(await ctx.fakes.templates.count()).toBe(0);
  });

  it('skips a claimed number left behind by a failed upload', async () => {
    await ctx.storage.put(
      'templates',
      templateConfigKey('acme-devfest-attendance-v0'),
      Buffer.from('{}'),
      {
        contentType: 'application/json',
      },
    );
    expect((await ctx.services.templates.publish(ctx.input)).reference).toBe(
      'acme-devfest-attendance-v1',
    );
  });

  it('rejects an invalid reference before any file is written', async () => {
    await expect(
      ctx.services.templates.publish({ ...ctx.input, organizationSlug: 'Bad_Slug' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(ctx.storage.objects.size).toBe(0);
    expect(await ctx.fakes.templates.count()).toBe(0);
  });

  it.each([
    ['unsupported path', [{ path: 'evil.sh', body: Buffer.from('x') }]],
    ['path traversal', [{ path: '../background.svg', body: Buffer.from('x') }]],
    ['missing background', [{ path: 'fonts/a.ttf', body: Buffer.from('x') }]],
    [
      'duplicates',
      [
        { path: 'background.svg', body: Buffer.from('x') },
        { path: 'background.svg', body: Buffer.from('y') },
      ],
    ],
  ])('rejects %s before writing', async (_name, badFiles) => {
    await expect(
      ctx.services.templates.publish({ ...ctx.input, files: badFiles }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(ctx.storage.objects.size).toBe(0);
  });

  it('removes the stored files when the document cannot be written', async () => {
    const failing = Object.assign(Object.create(ctx.fakes.templates) as object, {
      create: () => Promise.reject(new Error('boom')),
    });
    const services = buildServices({ ...ctx.fakes, templates: failing as never });
    await expect(services.templates.publish(ctx.input)).rejects.toThrow('boom');
    expect(ctx.storage.objects.size).toBe(0);
  });

  it('vetoes deleting the event and organization while templates exist', async () => {
    await ctx.services.templates.publish(ctx.input);
    await expect(ctx.services.events.delete(ctx.event.id)).rejects.toMatchObject({
      constructor: InUseError,
      details: [{ counts: { templates: 1 } }],
    });
    await expect(ctx.services.organizations.delete(ctx.org.id)).rejects.toBeInstanceOf(InUseError);
  });

  it('gets, lists and counts', async () => {
    const t = await ctx.services.templates.publish(ctx.input);
    expect(await ctx.services.templates.get(t.reference)).toEqual(t);
    await expect(ctx.services.templates.get('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(ctx.services.templates.get('missing-v0')).rejects.toBeInstanceOf(NotFoundError);
    expect((await ctx.services.templates.list({ eventId: ctx.event.id })).items).toHaveLength(1);
    expect((await ctx.services.templates.list({ eventId: '!!' })).items).toEqual([]);
    expect((await ctx.services.templates.list({ organizationId: '!!' })).items).toEqual([]);
    expect((await ctx.services.templates.list({ type: 'team' })).items).toEqual([]);
    expect(await ctx.services.templates.countByEvent('!!')).toBe(0);
    expect(await ctx.services.templates.countByOrganization('!!')).toBe(0);
    expect(await ctx.services.templates.getLatest('!!', ctx.event.id, 'attendance')).toBeNull();
  });
});
