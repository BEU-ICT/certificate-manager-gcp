import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SvgPdfRenderer,
  createFields,
  drawQr,
  type RenderInput,
} from '../../src/modules/pdf/index.js';
import {
  FORMAT_NAMES,
  KNOWN_FORMATS,
  parseTemplateConfig,
  validateTemplatePackage,
  type LoadedTemplate,
} from '../../src/modules/templates/index.js';
import {
  decodePng,
  differingShare,
  encodePng,
  extractText,
  pageCount,
  rasterize,
} from '../helpers/pdf-inspect.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/templates');
const PACKAGES = ['reference', 'portrait', 'minimal'] as const;

const INPUT: RenderInput = {
  ownerName: 'Aysel Məmmədova-Əliyeva',
  subject: 'devfest bakı 2026: ışıq, ürək və çiçək',
  skills: ['TypeScript', 'Cloud Run', 'Firestore', 'Привет мир'],
  issuedAt: new Date('2026-11-03T12:00:00.000Z'),
  organizationName: 'Acme Community',
  type: 'attendance',
  publicUrl: 'https://certs.example.test/c/AbCdEfGhIjKlMnOpQrStUv',
};

function walk(dir: string, base = dir): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      for (const [k, v] of walk(full, base)) files.set(k, v);
    } else if (name !== 'golden.png') {
      files.set(path.relative(base, full).split(path.sep).join('/'), readFileSync(full));
    }
  }
  return files;
}

function load(
  name: string,
  configOverride?: (c: Record<string, unknown>) => Record<string, unknown>,
) {
  const files = walk(path.join(ROOT, name));
  const raw = JSON.parse((files.get('config.json') as Buffer).toString('utf8')) as Record<
    string,
    unknown
  >;
  const parsed = parseTemplateConfig(configOverride ? configOverride(raw) : raw, {
    files: [...files.keys()],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return { files, config: parsed.config, warnings: parsed.warnings };
}

function assetsOf(name: string): LoadedTemplate {
  const { files, config } = load(name);
  const fonts = new Map<string, Buffer>();
  for (const [key, file] of Object.entries(config.fonts)) fonts.set(key, files.get(file) as Buffer);
  const images = new Map<string, Buffer>();
  for (const image of config.images ?? []) images.set(image.file, files.get(image.file) as Buffer);
  return {
    template: {
      reference: `reference-${name}-v0`,
      config,
    } as unknown as LoadedTemplate['template'],
    background: files.get(config.background) as Buffer,
    fonts,
    images,
  };
}

const { fieldsLayer, checkFit } = createFields();
const renderer = new SvgPdfRenderer({ fieldsLayer, qrLayer: drawQr, fitChecker: checkFit });

describe('reference template packages', () => {
  for (const name of PACKAGES) {
    describe(name, () => {
      it('validates with no errors', () => {
        const { files, config } = load(name);
        const result = validateTemplatePackage(files, config);
        expect(result.errors).toEqual([]);
        // The only tolerated finding is the licence file, which no config key can reference.
        expect(result.warnings.map((w) => `${w.code} ${w.file ?? w.path}`)).toEqual([
          'UNREFERENCED_FILE fonts/LICENSE.txt',
        ]);
      });

      it('ships a licence for every font', () => {
        expect(readFileSync(path.join(ROOT, name, 'fonts/LICENSE.txt'), 'utf8')).toContain(
          'SIL OPEN FONT LICENSE Version 1.1',
        );
      });

      it('fits the sample data and renders one page with the expected text', async () => {
        const assets = assetsOf(name);
        expect(renderer.checkFit(INPUT, assets)).toEqual({ fits: true, issues: [] });
        const pdf = await renderer.render(INPUT, assets);
        expect(await pageCount(pdf)).toBe(1);
        const text = await extractText(pdf);
        expect(text.toLowerCase()).toContain('aysel');
      });

      it('matches the golden raster', async () => {
        const pdf = await renderer.render(INPUT, assetsOf(name));
        const actual = await rasterize(pdf, 1);
        const golden = path.join(ROOT, name, 'golden.png');
        if (process.env['UPDATE_GOLDEN'] === '1') {
          mkdirSync(path.dirname(golden), { recursive: true });
          writeFileSync(golden, encodePng(actual));
        }
        expect(existsSync(golden), 'golden missing: run with UPDATE_GOLDEN=1').toBe(true);
        expect(differingShare(actual, await decodePng(readFileSync(golden)))).toBeLessThanOrEqual(
          0.001,
        );
      });
    });
  }

  it('every formatter is accepted by the validator on a field it fits', () => {
    for (const format of FORMAT_NAMES) {
      const kind = KNOWN_FORMATS[format];
      const field = kind === 'date' ? 'issuedAt' : kind === 'list' ? 'skills' : 'subject';
      const { files, config } = load('reference', (c) => {
        const fields = { ...(c['fields'] as Record<string, Record<string, unknown>>) };
        fields[field] = { ...fields[field], format };
        return { ...c, fields };
      });
      expect(validateTemplatePackage(files, config).errors, format).toEqual([]);
    }
  });

  it('reference uses every optional config key and field', () => {
    const { config } = load('reference');
    expect(Object.keys(config.fields).sort()).toEqual(
      ['issuedAt', 'ownerName', 'skills', 'subject', 'type'].sort(),
    );
    const keys = new Set(Object.values(config.fields).flatMap((f) => Object.keys(f)));
    for (const key of ['format', 'minSize', 'lineHeight', 'allowOverlap']) {
      expect(keys.has(key), key).toBe(true);
    }
    expect(config.images).toHaveLength(1);
    expect(config.locale).toBe('az');
  });
});
