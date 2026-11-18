import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { FsStorageGateway, registerFsPublicPdfRoutes } from '../../src/adapters/fs/index.js';

describe('fs public PDF routes', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

  async function setup() {
    const root = mkdtempSync(join(tmpdir(), 'cm-fs-'));
    roots.push(root);
    const storage = new FsStorageGateway(root, 'http://localhost:8080');
    await storage.put('pdfs', 'a/x.pdf', Buffer.from('%PDF'), { contentType: 'application/pdf' });
    await storage.put('templates', 'secret.json', Buffer.from('{}'), { contentType: 'text/plain' });
    const app = Fastify();
    registerFsPublicPdfRoutes(app, storage);
    return { app, storage };
  }

  it('serves GET/HEAD with no-cache, nothing else', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/pdfs/a/x.pdf' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect((await app.inject({ method: 'HEAD', url: '/pdfs/a/x.pdf' })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'PUT', url: '/pdfs/a/x.pdf', payload: 'x' })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/pdfs/a/x.pdf' })).statusCode).toBe(404);
  });

  it('has no directory listing and no traversal', async () => {
    const { app } = await setup();
    for (const url of [
      '/pdfs/',
      '/pdfs',
      '/pdfs/a',
      '/pdfs/a/',
      '/pdfs/%2e%2e/templates/secret.json',
      '/pdfs/..%2ftemplates%2fsecret.json',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
  });

  it('deleted PDFs are inaccessible immediately', async () => {
    const { app, storage } = await setup();
    await storage.delete('pdfs', 'a/x.pdf');
    expect((await app.inject({ method: 'GET', url: '/pdfs/a/x.pdf' })).statusCode).toBe(404);
  });
});
