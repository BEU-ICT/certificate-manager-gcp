import { describe, expect, it } from 'vitest';
import {
  createStorageClient,
  createStorageGateway,
  emulatorEndpoint,
} from '../../src/adapters/gcs/index.js';
import { GcsStorageGateway } from '../../src/adapters/gcs/gcs-storage-gateway.js';
import { NotFoundError, UnavailableError } from '../../src/shared/errors.js';
import { FakeGcsClient } from './fakes/fake-gcs-client.js';

function setup() {
  const client = new FakeGcsClient();
  const gateway = new GcsStorageGateway({
    client,
    templatesBucket: 'p-templates',
    pdfBucket: 'p-pdfs',
    pdfPublicBaseUrl: 'https://storage.googleapis.com/p-pdfs/',
  });
  return { client, gateway };
}
const pdf = { contentType: 'application/pdf' };

describe('GcsStorageGateway', () => {
  it('maps kinds to the configured buckets', async () => {
    const { client, gateway } = setup();
    await gateway.put('templates', 't.json', Buffer.from('a'), { contentType: 'application/json' });
    await gateway.put('pdfs', 'c.pdf', Buffer.from('b'), pdf);
    expect([...client.buckets.get('p-templates')!.keys()]).toEqual(['t.json']);
    expect([...client.buckets.get('p-pdfs')!.keys()]).toEqual(['c.pdf']);
  });

  it('defaults PDFs to Cache-Control no-cache and lets the caller override it', async () => {
    const { client, gateway } = setup();
    await gateway.put('pdfs', 'a.pdf', Buffer.from('x'), pdf);
    await gateway.put('pdfs', 'b.pdf', Buffer.from('x'), { ...pdf, cacheControl: 'max-age=60' });
    await gateway.put('templates', 'a', Buffer.from('x'), pdf);
    const pdfs = client.buckets.get('p-pdfs')!;
    expect(pdfs.get('a.pdf')?.cacheControl).toBe('no-cache');
    expect(pdfs.get('b.pdf')?.cacheControl).toBe('max-age=60');
    expect(client.buckets.get('p-templates')!.get('a')?.cacheControl).toBeUndefined();
  });

  it('stores content type and disposition; putIfAbsent sends ifGenerationMatch=0', async () => {
    const { client, gateway } = setup();
    const options = { ...pdf, contentDisposition: 'inline; filename="c.pdf"' };
    expect(await gateway.putIfAbsent('pdfs', 'c.pdf', Buffer.from('x'), options)).toEqual({
      created: true,
    });
    const stored = client.buckets.get('p-pdfs')!.get('c.pdf');
    expect(stored).toMatchObject({
      contentType: 'application/pdf',
      contentDisposition: 'inline; filename="c.pdf"',
    });
  });

  it('copy keeps metadata and reports a missing source as NotFoundError', async () => {
    const { client, gateway } = setup();
    await gateway.put('pdfs', 'a.pdf', Buffer.from('x'), pdf);
    await gateway.copy('pdfs', 'a.pdf', 'b.pdf');
    expect(client.buckets.get('p-pdfs')!.get('b.pdf')?.cacheControl).toBe('no-cache');
    await expect(gateway.copy('pdfs', 'nope', 'c')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('builds public URLs without I/O and without a double slash', () => {
    const { gateway } = setup();
    expect(gateway.publicUrl('pdfs/abc.pdf')).toBe(
      'https://storage.googleapis.com/p-pdfs/pdfs/abc.pdf',
    );
  });

  it('rejects keys that start with "/"', async () => {
    const { gateway } = setup();
    await expect(gateway.get('pdfs', '/x')).rejects.toBeInstanceOf(RangeError);
  });

  it.each([{ code: 503 }, { code: 429 }, { code: 403 }, new Error('ETIMEDOUT')])(
    'surfaces backend failure %# as UnavailableError for every operation',
    async (failure) => {
      const { client, gateway } = setup();
      client.failWith = failure;
      const calls = [
        gateway.put('pdfs', 'k', Buffer.from('x'), pdf),
        gateway.putIfAbsent('pdfs', 'k', Buffer.from('x'), pdf),
        gateway.get('pdfs', 'k'),
        gateway.delete('pdfs', 'k'),
        gateway.copy('pdfs', 'k', 'j'),
        gateway.list('pdfs', ''),
      ];
      for (const call of calls) await expect(call).rejects.toBeInstanceOf(UnavailableError);
    },
  );
});

describe('GCS client factory', () => {
  it('turns STORAGE_EMULATOR_HOST into an http origin', () => {
    expect(emulatorEndpoint({})).toBeUndefined();
    expect(emulatorEndpoint({ STORAGE_EMULATOR_HOST: 'localhost:4443' })).toBe(
      'http://localhost:4443',
    );
    expect(emulatorEndpoint({ STORAGE_EMULATOR_HOST: 'https://gcs.test:4443/' })).toBe(
      'https://gcs.test:4443',
    );
  });

  it('uses the emulator endpoint without credentials and restores the variable', () => {
    const env: NodeJS.ProcessEnv = { STORAGE_EMULATOR_HOST: 'localhost:4443' };
    const client = createStorageClient('demo-p', env);
    expect(env['STORAGE_EMULATOR_HOST']).toBe('localhost:4443');
    expect(client.apiEndpoint).toBe('http://localhost:4443');
    expect(client.bucket('b').file('k/x.pdf').baseUrl).toBe('/o');
  });

  it('requires both bucket names', () => {
    const config = { storage: { templatesBucket: 't', pdfBucket: undefined } } as never;
    expect(() => createStorageGateway({ config })).toThrow(/TEMPLATES_BUCKET and PDF_BUCKET/);
  });
});
