import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DrawLayer } from '../../src/modules/pdf/index.js';
import type { LoadedTemplate } from '../../src/modules/templates/index.js';
import type { RenderInput } from '../../src/modules/pdf/index.js';

const GOOD = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/templates/good',
);

/** The committed sample package as engine assets (no storage involved). */
export function loadSampleAssets(
  overrides: { config?: (c: Record<string, unknown>) => Record<string, unknown> } = {},
): LoadedTemplate {
  const read = (file: string): Buffer => readFileSync(path.join(GOOD, file));
  const parsed = JSON.parse(read('config.json').toString('utf8')) as Record<string, unknown>;
  const config = overrides.config ? overrides.config(parsed) : parsed;
  return {
    template: {
      reference: 'acme-devfest-attendance-v1',
      organizationId: 'org',
      eventId: 'evt',
      organizationSlug: 'acme',
      eventSlug: 'devfest',
      type: 'attendance',
      version: 1,
      storagePath: 'templates/acme-devfest-attendance-v1/',
      config,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      createdBy: 'admin',
      schemaVersion: 1,
    } as LoadedTemplate['template'],
    background: read('background.svg'),
    fonts: new Map([['main', read('fonts/main.ttf')]]),
    images: new Map([['assets/logo.png', read('assets/logo.png')]]),
  };
}

export const SAMPLE_INPUT: RenderInput = {
  ownerName: 'Aysel Məmmədova',
  subject: 'DevFest 2026',
  skills: ['TypeScript'],
  issuedAt: new Date('2026-11-03T23:30:00.000Z'),
  organizationName: 'Acme Community',
  type: 'attendance',
  publicUrl: 'https://certs.example.test/v/AbCdEfGhIjKlMnOpQrStUv',
};

/** Test-only text layer standing in for the fields task: draws owner name and subject. */
export const sampleTextLayer: DrawLayer = (ctx) => {
  const { doc, input } = ctx;
  doc.font(ctx.fontName('main'));
  doc
    .fillColor('#1d3557')
    .fontSize(36)
    .text(input.ownerName, 100, 250, { width: 640, align: 'center' });
  doc
    .fillColor('#333333')
    .fontSize(20)
    .text(input.subject, 100, 330, { width: 640, align: 'center' });
};
