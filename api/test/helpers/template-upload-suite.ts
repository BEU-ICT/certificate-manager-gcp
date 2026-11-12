/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildServices } from '../../src/services.js';
import { UnavailableError } from '../../src/shared/errors.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';
import type { Services } from '../../src/wiring.js';

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`../fixtures/templates/good/${name}`, import.meta.url));

const GOOD_CONFIG = fixture('config.json').toString('utf8');
const GOOD_FILES: Record<string, Buffer> = {
  'background.svg': fixture('background.svg'),
  'fonts/main.ttf': fixture('fonts/main.ttf'),
  'assets/logo.png': fixture('assets/logo.png'),
};

interface FormSpec {
  fields?: Record<string, string>;
  /** `undefined` leaves the config out; a string is sent as a file part named `config`. */
  config?: string | undefined;
  configAsField?: boolean;
  files?: Record<string, Buffer>;
  /** Extra file parts, to allow duplicate names. */
  extraFiles?: [string, Buffer][];
  mime?: string;
}

/** Serialises a multipart body; the part name is `files`, the file name is the relative path. */
async function multipartBody(spec: FormSpec): Promise<{ payload: Buffer; contentType: string }> {
  const form = new FormData();
  for (const [name, value] of Object.entries(spec.fields ?? {})) form.append(name, value);
  if (spec.config !== undefined) {
    if (spec.configAsField === true) form.append('config', spec.config);
    else
      form.append('config', new Blob([spec.config], { type: 'application/json' }), 'config.json');
  }
  const mime = spec.mime ?? 'application/octet-stream';
  const files = [...Object.entries(spec.files ?? {}), ...(spec.extraFiles ?? [])];
  for (const [path, body] of files)
    form.append('files', new Blob([new Uint8Array(body)], { type: mime }), path);
  const response = new Response(form);
  return {
    payload: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
  };
}

/**
 * Behaviour of `POST /api/v1/admin/templates`, run against in-memory fakes (unit) and against
 * the Firestore adapters on the emulator (integration); the storage is always in memory.
 */
export function describeTemplateUploadApi(
  name: string,
  makePorts: () => Promise<Fakes> | Fakes,
): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
  const errorLogs: Record<string, unknown>[] = [];
  const logLines: string[] = [];

  async function setup() {
    errorLogs.length = 0;
    logLines.length = 0;
    const fakes = await makePorts();
    const services: Services = buildServices(fakes, undefined, {
      logger: {
        info: () => undefined,
        error: (obj) => void errorLogs.push(obj),
      },
    });
    app = buildApp({
      ports: fakes,
      services,
      log: { level: 'info', destination: { write: (line: string) => void logLines.push(line) } },
    });
    const org = await services.organizations.create({ name: 'Acme', slug: 'acme' });
    const other = await services.organizations.create({ name: 'Other', slug: 'other' });
    const event = await services.events.create({
      organizationId: org.id,
      name: 'DevFest',
      slug: 'devfest',
    });
    const otherEvent = await services.events.create({
      organizationId: other.id,
      name: 'Summit',
      slug: 'summit',
    });
    const storage = fakes.storage as unknown as {
      objects: Map<string, { body: Buffer; options: { contentType: string } }>;
      put: (...args: unknown[]) => Promise<void>;
    };
    const fields = (type = 'attendance') => ({
      organizationId: org.id,
      eventId: event.id,
      type,
    });
    const upload = async (spec: FormSpec, headers: Record<string, string> = admin) => {
      const { payload, contentType } = await multipartBody(spec);
      return app!.inject({
        method: 'POST',
        url: '/api/v1/admin/templates',
        headers: { ...headers, 'content-type': contentType },
        payload,
      });
    };
    const good = (extra: Partial<FormSpec> = {}): FormSpec => ({
      fields: fields(),
      config: GOOD_CONFIG,
      files: GOOD_FILES,
      ...extra,
    });
    const stored = () => [...storage.objects.keys()].sort();
    return {
      fakes,
      services,
      org,
      other,
      event,
      otherEvent,
      storage,
      fields,
      upload,
      good,
      stored,
    };
  }

  describe(`template upload API: ${name}`, () => {
    it('stores the files under the right keys, writes the document and returns the DTO', async () => {
      const { upload, good, stored, services, org, event, storage } = await setup();
      const res = await upload(good());
      expect(res.statusCode).toBe(201);
      const body = res.json();
      const storedConfig = storage.objects.get(
        'templates:templates/acme-devfest-attendance-v0/config.json',
      )!.body;
      expect(body).toEqual({
        reference: 'acme-devfest-attendance-v0',
        version: 0,
        organizationId: org.id,
        eventId: event.id,
        type: 'attendance',
        config: JSON.parse(storedConfig.toString('utf8')),
        files: [
          { path: 'assets/logo.png', size: GOOD_FILES['assets/logo.png']!.length },
          { path: 'background.svg', size: GOOD_FILES['background.svg']!.length },
          { path: 'config.json', size: storedConfig.length },
          { path: 'fonts/main.ttf', size: GOOD_FILES['fonts/main.ttf']!.length },
        ],
        warnings: expect.any(Array),
        createdAt: expect.stringMatching(/Z$/),
      });
      expect(body.config).toMatchObject(JSON.parse(GOOD_CONFIG));
      expect(res.headers['cache-control']).toBe('no-store');
      expect(stored()).toEqual([
        'templates:templates/acme-devfest-attendance-v0/assets/logo.png',
        'templates:templates/acme-devfest-attendance-v0/background.svg',
        'templates:templates/acme-devfest-attendance-v0/config.json',
        'templates:templates/acme-devfest-attendance-v0/fonts/main.ttf',
      ]);
      expect(
        storage.objects.get('templates:templates/acme-devfest-attendance-v0/background.svg')?.body,
      ).toEqual(GOOD_FILES['background.svg']);
      const doc = await services.templates.get('acme-devfest-attendance-v0');
      expect(doc).toMatchObject({
        organizationId: org.id,
        eventId: event.id,
        type: 'attendance',
        version: 0,
        createdBy: 'admin-1',
      });
      const audit = logLines.map((l) => JSON.parse(l)).find((l) => l.audit === true);
      expect(audit).toMatchObject({
        action: 'template.created',
        entityId: 'acme-devfest-attendance-v0',
        adminUid: 'admin-1',
      });
    });

    it('accepts the config as a plain text field and creates v1 on the second upload', async () => {
      const { upload, good, fields } = await setup();
      expect((await upload(good())).json().reference).toBe('acme-devfest-attendance-v0');
      const second = await upload(good({ configAsField: true }));
      expect(second.statusCode).toBe(201);
      expect(second.json()).toMatchObject({
        reference: 'acme-devfest-attendance-v1',
        version: 1,
      });
      const thanks = await upload(good({ fields: fields('thanks') }));
      expect(thanks.json().reference).toBe('acme-devfest-thanks-v0');
    });

    it('does not trust the declared MIME type: the content type comes from the path', async () => {
      const { upload, good, storage } = await setup();
      const res = await upload(good({ mime: 'text/html' }));
      expect(res.statusCode).toBe(201);
      const types = Object.fromEntries(
        [...storage.objects].map(([key, value]) => [
          key.split('/').slice(2).join('/'),
          value.options.contentType,
        ]),
      );
      expect(types).toEqual({
        'background.svg': 'image/svg+xml',
        'config.json': 'application/json',
        'fonts/main.ttf': 'font/ttf',
        'assets/logo.png': 'image/png',
      });
    });

    it('never overwrites an existing template: a taken version number is skipped', async () => {
      const { upload, good, storage, stored } = await setup();
      const key = 'templates:templates/acme-devfest-attendance-v0/config.json';
      storage.objects.set(key, { body: Buffer.from('sentinel'), options: { contentType: 'x' } });
      const res = await upload(good());
      expect(res.statusCode).toBe(201);
      expect(res.json().reference).toBe('acme-devfest-attendance-v1');
      expect(storage.objects.get(key)?.body.toString()).toBe('sentinel');
      expect(stored()).toHaveLength(5);
    });

    it('counts as one request for the admin rate limiter', async () => {
      const { fakes, upload, good } = await setup();
      const keys: string[] = [];
      const original = fakes.rateLimiter.consume.bind(fakes.rateLimiter);
      fakes.rateLimiter.consume = (key, ...args) => {
        keys.push(key);
        return original(key, ...args);
      };
      expect((await upload(good())).statusCode).toBe(201);
      // One count per scope: the IP pre-auth budget and the per-admin budget.
      expect(keys.filter((k) => k.startsWith('admin-auth:ip:'))).toHaveLength(1);
      expect(keys.filter((k) => k.startsWith('admin:'))).toHaveLength(1);
      expect(keys).toHaveLength(2);
    });

    it('reports every issue of an invalid package as 422 TEMPLATE_INVALID and stores nothing', async () => {
      const { upload, good, stored, services } = await setup();
      const config = JSON.parse(GOOD_CONFIG);
      config.fonts = { main: 'fonts/missing.ttf' };
      const files = {
        ...GOOD_FILES,
        'background.svg': Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 842 595"><script>alert(1)</script></svg>',
        ),
      };
      const res = await upload(good({ config: JSON.stringify(config), files }));
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('TEMPLATE_INVALID');
      expect(res.json().error.details.length).toBeGreaterThan(0);
      expect(stored()).toEqual([]);
      expect((await services.templates.list()).items).toEqual([]);

      const svgOnly = await upload(good({ files }));
      const details = svgOnly.json().error.details;
      expect(svgOnly.statusCode).toBe(422);
      expect(details).toContainEqual(
        expect.objectContaining({ code: 'SVG_SCRIPT', file: 'background.svg' }),
      );
      for (const detail of details) {
        expect(detail).toEqual({
          code: expect.any(String),
          path: expect.any(String),
          message: expect.any(String),
          ...(detail.file === undefined ? {} : { file: expect.any(String) }),
        });
      }
      expect(stored()).toEqual([]);
    });

    it('rejects a config that references a file that was not uploaded', async () => {
      const { upload, good, stored } = await setup();
      const rest = Object.fromEntries(
        Object.entries(GOOD_FILES).filter(([path]) => path !== 'fonts/main.ttf'),
      );
      const res = await upload(good({ files: rest }));
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details).toContainEqual(
        expect.objectContaining({ code: 'FILE_NOT_FOUND', path: 'fonts.main' }),
      );
      expect(stored()).toEqual([]);
    });

    it('cleans up and creates no document when the storage fails mid-upload', async () => {
      const { upload, good, storage, stored, services } = await setup();
      const original = storage.put.bind(storage);
      let puts = 0;
      storage.put = (...args: unknown[]) => {
        puts += 1;
        return puts === 2 ? Promise.reject(new UnavailableError()) : original(...args);
      };
      const res = await upload(good());
      expect(res.statusCode).toBe(503);
      expect(puts).toBeGreaterThanOrEqual(2);
      expect(stored()).toEqual([]);
      expect((await services.templates.list()).items).toEqual([]);
      expect(errorLogs).toEqual([
        expect.objectContaining({ reference: 'acme-devfest-attendance-v0', leakedObjects: 0 }),
      ]);
      storage.put = original;
      expect((await upload(good())).json().reference).toBe('acme-devfest-attendance-v0');
    });

    it('answers 413 for oversize bodies, parts and file counts', async () => {
      const { upload, good, stored } = await setup();
      const big = (mb: number) => Buffer.alloc(mb * 1024 * 1024, 1);
      const declared = await upload(good({ files: { ...GOOD_FILES, 'assets/big.png': big(11) } }));
      expect(declared.statusCode).toBe(413);
      expect(declared.json().error.code).toBe('PAYLOAD_TOO_LARGE');

      // Without a Content-Length header the limits are enforced while streaming.
      const { payload, contentType } = await multipartBody(
        good({ files: { ...GOOD_FILES, 'assets/big.png': big(11) } }),
      );
      const streamed = await app!.inject({
        method: 'POST',
        url: '/api/v1/admin/templates',
        headers: { ...admin, 'content-type': contentType },
        payload: Readable.from([payload]),
      });
      expect(streamed.statusCode).toBe(413);

      const font = await upload(good({ files: { ...GOOD_FILES, 'fonts/big.ttf': big(4) } }));
      expect(font.statusCode).toBe(413);
      const part = await upload(good({ files: { ...GOOD_FILES, 'assets/big.png': big(6) } }));
      expect(part.statusCode).toBe(413);
      const total = await upload(
        good({
          files: {
            ...GOOD_FILES,
            'assets/a.png': big(4),
            'assets/b.png': big(4),
            'assets/c.png': big(4),
          },
        }),
      );
      expect(total.statusCode).toBe(413);

      const many = Object.fromEntries(
        Array.from({ length: 31 }, (_, i) => [`assets/f${String(i)}.png`, Buffer.from('x')]),
      );
      const count = await upload(good({ files: { ...GOOD_FILES, ...many } }));
      expect(count.statusCode).toBe(413);
      expect(stored()).toEqual([]);
    });

    it('rejects an oversized text field with 413', async () => {
      const { upload, good, fields } = await setup();
      const res = await upload(good({ fields: { ...fields(), organizationId: 'x'.repeat(300) } }));
      expect(res.statusCode).toBe(413);
    });

    it('answers 503 on timeout and stores nothing when the handler resumes', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        const { upload, good, services, stored } = await setup();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const original = services.events.get.bind(services.events);
        services.events.get = async (id) => {
          await gate;
          return original(id);
        };
        const pending = upload(good());
        await vi.advanceTimersByTimeAsync(56_000);
        const res = await pending;
        expect(res.statusCode).toBe(503);
        expect(res.json().error.code).toBe('UNAVAILABLE');
        release();
        await vi.advanceTimersByTimeAsync(100);
        expect(stored()).toEqual([]);
        expect((await services.templates.list()).items).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('answers 422 EVENT_ORG_MISMATCH and 404 for unknown parents, storing nothing', async () => {
      const { upload, good, org, otherEvent, stored } = await setup();
      const mismatch = await upload(
        good({ fields: { organizationId: org.id, eventId: otherEvent.id, type: 'attendance' } }),
      );
      expect(mismatch.statusCode).toBe(422);
      expect(mismatch.json().error.code).toBe('EVENT_ORG_MISMATCH');
      const noOrg = await upload(
        good({ fields: { organizationId: 'nope', eventId: otherEvent.id, type: 'attendance' } }),
      );
      expect(noOrg.statusCode).toBe(404);
      expect(noOrg.json().error.details[0].path).toBe('organizationId');
      const noEvent = await upload(
        good({ fields: { organizationId: org.id, eventId: 'nope', type: 'attendance' } }),
      );
      expect(noEvent.statusCode).toBe(404);
      expect(noEvent.json().error.details[0].path).toBe('eventId');
      expect(stored()).toEqual([]);
    });

    it('answers 400 for a missing or malformed config, bad fields and non-multipart bodies', async () => {
      const { upload, good, fields, stored } = await setup();
      const noConfig = await upload(good({ config: undefined }));
      expect(noConfig.statusCode).toBe(400);
      expect(noConfig.json().error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path: 'config' }],
      });
      expect((await upload(good({ config: '{not json' }))).statusCode).toBe(400);
      expect((await upload(good({ fields: { ...fields(), type: 'bogus' } }))).statusCode).toBe(400);
      expect((await upload(good({ fields: { eventId: fields().eventId } }))).statusCode).toBe(400);
      expect((await upload(good({ fields: { ...fields(), extra: '1' } }))).statusCode).toBe(400);
      const json = await app!.inject({
        method: 'POST',
        url: '/api/v1/admin/templates',
        headers: { ...admin, 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(json.statusCode).toBe(400);
      expect(stored()).toEqual([]);
    });

    it('answers 401 without a token and 403 for non-admins', async () => {
      const { upload, good, stored } = await setup();
      expect((await upload(good(), {})).statusCode).toBe(401);
      const user = await upload(good(), { authorization: `Bearer ${fakeToken('u1')}` });
      expect(user.statusCode).toBe(403);
      expect(user.json().error.code).toBe('FORBIDDEN');
      expect(stored()).toEqual([]);
    });

    it.each([
      ['parent directory', '../evil.svg'],
      ['nested parent directory', 'assets/../../evil.svg'],
      ['absolute path', '/etc/evil.svg'],
      ['backslash', 'fonts\\evil.ttf'],
      ['dot segment', './evil.svg'],
      ['percent encoding', '%2e%2e/evil.svg'],
      ['not a package location', 'other/evil.svg'],
      ['control character', 'assets/ev\u0000il.png'],
    ])('rejects a path traversal attempt (%s) and stores nothing', async (_label, path) => {
      const { upload, good, stored, services } = await setup();
      const res = await upload(good({ extraFiles: [[path, Buffer.from('x')]] }));
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(stored()).toEqual([]);
      expect((await services.templates.list()).items).toEqual([]);
    });

    it('rejects names that differ only in case, repeated names and the reserved config.json', async () => {
      const { upload, good, stored } = await setup();
      const caseTwin = await upload(
        good({ extraFiles: [['Background.svg', GOOD_FILES['background.svg']!]] }),
      );
      expect(caseTwin.statusCode).toBe(422);
      expect(caseTwin.json().error.details).toContainEqual(
        expect.objectContaining({ code: 'FILENAME_DUPLICATE_CASE' }),
      );
      const twice = await upload(
        good({ extraFiles: [['background.svg', GOOD_FILES['background.svg']!]] }),
      );
      expect(twice.statusCode).toBe(422);
      expect(twice.json().error.details).toContainEqual(
        expect.objectContaining({ code: 'FILENAME_DUPLICATE' }),
      );
      const reserved = await upload(good({ extraFiles: [['config.json', Buffer.from('{}')]] }));
      expect(reserved.statusCode).toBe(422);
      expect(reserved.json().error.details).toContainEqual(
        expect.objectContaining({ code: 'FILENAME_RESERVED' }),
      );
      expect(stored()).toEqual([]);
    });
  });
}
