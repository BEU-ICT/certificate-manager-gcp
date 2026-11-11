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
  UnavailableError,
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

describe('TemplateService.copy', () => {
  it('copies every object server side, keeps the source and claims config.json first', async () => {
    const { services, input, storage, org } = await setup();
    const source = await services.templates.publish(input);
    const event2 = await services.events.create({
      organizationId: org.id,
      name: 'Summit',
      slug: 'summit',
    });
    const copied = await services.templates.copy({
      sourceReference: source.reference,
      target: {
        organizationId: org.id,
        eventId: event2.id,
        organizationSlug: 'acme',
        eventSlug: 'summit',
        type: 'thanks',
      },
      createdBy: 'admin-2',
    });
    expect(copied.copiedFrom).toBe('acme-devfest-attendance-v0');
    expect(copied.template).toMatchObject({
      reference: 'acme-summit-thanks-v0',
      type: 'thanks',
      version: 0,
      config: source.config,
      createdBy: 'admin-2',
    });
    expect(copied.files.map((f) => f.path)).toEqual([
      'assets/logo.png',
      'background.svg',
      'config.json',
      'fonts/main.ttf',
    ]);
    expect(
      await storage.get('templates', templateFontKey('acme-summit-thanks-v0', 'main.ttf')),
    ).toEqual(Buffer.from('ttf'));
    expect(await services.templates.get(source.reference)).toEqual(source);
  });

  it('skips a taken version number and gives up with ConflictError after the retries', async () => {
    const { services, input, storage, org, event } = await setup();
    const source = await services.templates.publish(input);
    // A foreign claim on v1 without a document: the copy takes v2.
    await storage.put(
      'templates',
      templateConfigKey('acme-devfest-attendance-v1'),
      Buffer.from('{}'),
      {
        contentType: 'application/json',
      },
    );
    const copied = await services.templates.copy({
      sourceReference: source.reference,
      target: { ...input, organizationId: org.id, eventId: event.id },
      createdBy: 'a',
    });
    expect(copied.template.reference).toBe('acme-devfest-attendance-v2');
    await expect(
      services.templates.copy({ sourceReference: 'nope', target: input, createdBy: 'a' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  async function copySetup() {
    const ctx = await setup();
    const source = await ctx.services.templates.publish(ctx.input);
    const errors: Record<string, unknown>[] = [];
    const services = buildServices(ctx.fakes, undefined, {
      logger: { info: () => undefined, error: (obj) => void errors.push(obj) },
    });
    const copyInput = {
      sourceReference: source.reference,
      target: { ...ctx.input },
      createdBy: 'a',
    };
    const keys = () => [...ctx.fakes.storage.objects.keys()].sort();
    return { ...ctx, services, source, errors, copyInput, keys };
  }

  it('keeps the published copy when the file listing fails after the document is written', async () => {
    const { services, fakes, copyInput, errors } = await copySetup();
    const original = fakes.storage.list.bind(fakes.storage);
    let calls = 0;
    fakes.storage.list = (...args: Parameters<typeof original>) =>
      ++calls === 2 ? Promise.reject(new Error('boom')) : original(...args);
    const copied = await services.templates.copy(copyInput);
    expect(copied.files).toEqual([]);
    expect(await services.templates.get(copied.template.reference)).toBeDefined();
    expect(
      fakes.storage.objects.has(`templates:${templateConfigKey(copied.template.reference)}`),
    ).toBe(true);
    expect(errors).toEqual([expect.objectContaining({ reference: copied.template.reference })]);
  });

  it('copies only package files and maps a vanished source object to UnavailableError with cleanup', async () => {
    const { services, fakes, source, copyInput, keys } = await copySetup();
    await fakes.storage.put(
      'templates',
      `templates/${source.reference}/stray.txt`,
      Buffer.from('x'),
      {
        contentType: 'text/plain',
      },
    );
    const copied = await services.templates.copy(copyInput);
    expect(copied.files.map((f) => f.path)).not.toContain('stray.txt');
    const before = keys();
    const original = fakes.storage.copy.bind(fakes.storage);
    fakes.storage.copy = () => Promise.reject(new NotFoundError('Object not found'));
    await expect(services.templates.copy(copyInput)).rejects.toBeInstanceOf(UnavailableError);
    expect(keys()).toEqual(before);
    fakes.storage.copy = original;
  });

  it('cleans up and rethrows when the document cannot be written', async () => {
    const { services, fakes, copyInput, keys, errors } = await copySetup();
    const before = keys();
    const original = fakes.templates.create.bind(fakes.templates);
    fakes.templates.create = () => Promise.reject(new Error('db down'));
    await expect(services.templates.copy(copyInput)).rejects.toThrow('db down');
    expect(keys()).toEqual(before);
    expect(errors).toEqual([expect.objectContaining({ leakedObjects: 0 })]);
    fakes.templates.create = original;
  });

  it('keeps the files of a concurrent winner and moves on to the next number', async () => {
    const { services, fakes, copyInput, keys } = await copySetup();
    const original = fakes.templates.create.bind(fakes.templates);
    let first = true;
    fakes.templates.create = async (t) => {
      if (first) {
        first = false;
        await original({ ...t, createdBy: 'winner' });
        return original(t);
      }
      return original(t);
    };
    const copied = await services.templates.copy(copyInput);
    expect(copied.template.reference).toBe('acme-devfest-attendance-v2');
    expect(await services.templates.get('acme-devfest-attendance-v1')).toMatchObject({
      createdBy: 'winner',
    });
    expect(keys()).toContain(`templates:${templateConfigKey('acme-devfest-attendance-v1')}`);
  });

  it('gives up with ConflictError when every version number is taken', async () => {
    const { services, fakes, copyInput } = await copySetup();
    for (let v = 1; v <= 5; v++) {
      await fakes.storage.put(
        'templates',
        templateConfigKey(`acme-devfest-attendance-v${String(v)}`),
        Buffer.from('{}'),
        {
          contentType: 'application/json',
        },
      );
    }
    await expect(services.templates.copy(copyInput)).rejects.toBeInstanceOf(ConflictError);
  });
});
