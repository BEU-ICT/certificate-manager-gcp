// Deterministic generator of the template-package test corpus (`npm run template-fixtures:generate
// -w api`). The binary fixtures (fonts, PNGs) are committed; tests import the builders for cases
// that are too big to commit (an image over 2 MB, a 30+ file package).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const AZ = 'AaBbCcÇçDdEeƏəFfGgĞğHhXxIıİiJjKkQqLlMmNnOoÖöPpRrSsŞşTtUuÜüVvYyZz';
const BASIC = ` 0123456789.,-'’()/:;!?`;
const CYRILLIC =
  Array.from({ length: 0x44f - 0x410 + 1 }, (_, i) => String.fromCodePoint(0x410 + i)).join('') +
  'Ёё';

/** Characters of the corpus fonts. `withoutSchwa` and `withoutCyrillic` build the negative cases. */
export function fontCharacters(options: { schwa?: boolean; cyrillic?: boolean } = {}): string {
  const { schwa = true, cyrillic = true } = options;
  let text = AZ + BASIC + (cyrillic ? CYRILLIC : '');
  if (!schwa) text = text.replace(/[Əə]/g, '');
  return text;
}

function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value);
  return b;
}
function u32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value >>> 0);
  return b;
}
function i16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(value);
  return b;
}
const pad4 = (b: Buffer): Buffer => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);

function checksum(b: Buffer): number {
  const padded = pad4(b);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

/** A minimal valid TrueType font whose glyphs are empty; only the cmap matters for coverage checks. */
export function buildFont(characters: string, family = 'Fixture Sans'): Buffer {
  const codePoints = [...new Set([...characters].map((c) => c.codePointAt(0) ?? 0))].sort(
    (a, b) => a - b,
  );
  const numGlyphs = codePoints.length + 1;

  const groups: [number, number, number][] = [];
  codePoints.forEach((cp, index) => {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[1] + 1 === cp) last[1] = cp;
    else groups.push([cp, cp, index + 1]);
  });
  const cmap = Buffer.concat([
    u16(0),
    u16(1),
    u16(3),
    u16(10),
    u32(12),
    u16(12),
    u16(0),
    u32(16 + groups.length * 12),
    u32(0),
    u32(groups.length),
    ...groups.map(([start, end, glyph]) => Buffer.concat([u32(start), u32(end), u32(glyph)])),
  ]);

  const head = Buffer.concat([
    u32(0x00010000),
    u32(0x00010000),
    u32(0),
    u32(0x5f0f3cf5),
    u16(0),
    u16(1000),
    Buffer.alloc(16),
    i16(0),
    i16(0),
    i16(0),
    i16(0),
    u16(0),
    u16(8),
    i16(2),
    i16(0),
    i16(0),
  ]);
  const hhea = Buffer.concat([
    u32(0x00010000),
    i16(800),
    i16(-200),
    i16(0),
    u16(500),
    i16(0),
    i16(0),
    i16(0),
    i16(1),
    i16(0),
    i16(0),
    Buffer.alloc(8),
    i16(0),
    u16(numGlyphs),
  ]);
  const maxp = Buffer.concat([u32(0x00010000), u16(numGlyphs), Buffer.alloc(26)]);
  const hmtx = Buffer.concat(
    Array.from({ length: numGlyphs }, () => Buffer.concat([u16(500), i16(0)])),
  );
  const loca = Buffer.alloc((numGlyphs + 1) * 2);
  const glyf = Buffer.alloc(4);

  const strings = [family, 'Regular', `${family} Regular`, family.replace(/\s/g, '-')];
  const ids = [1, 2, 4, 6];
  const encoded = strings.map((s) => Buffer.from(s, 'utf16le').swap16());
  let offset = 0;
  const records = encoded.map((text, i) => {
    const record = Buffer.concat([
      u16(3),
      u16(1),
      u16(0x409),
      u16(ids[i] ?? 0),
      u16(text.length),
      u16(offset),
    ]);
    offset += text.length;
    return record;
  });
  const name = Buffer.concat([u16(0), u16(4), u16(6 + 12 * 4), ...records, ...encoded]);
  const post = Buffer.concat([u32(0x00030000), u32(0), i16(-100), i16(50), Buffer.alloc(20)]);

  const tables: [string, Buffer][] = [
    ['cmap', cmap],
    ['glyf', glyf],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['loca', loca],
    ['maxp', maxp],
    ['name', name],
    ['post', post],
  ];
  const count = tables.length;
  const entrySelector = Math.floor(Math.log2(count));
  const searchRange = 2 ** entrySelector * 16;
  let position = 12 + count * 16;
  const directory: Buffer[] = [];
  const bodies: Buffer[] = [];
  for (const [tag, body] of tables) {
    directory.push(
      Buffer.concat([
        Buffer.from(tag, 'latin1'),
        u32(checksum(body)),
        u32(position),
        u32(body.length),
      ]),
    );
    const padded = pad4(body);
    bodies.push(padded);
    position += padded.length;
  }
  const font = Buffer.concat([
    u32(0x00010000),
    u16(count),
    u16(searchRange),
    u16(entrySelector),
    u16(count * 16 - searchRange),
    ...directory,
    ...bodies,
  ]);
  const headOffset =
    12 + count * 16 + tables.slice(0, 2).reduce((n, [, b]) => n + pad4(b).length, 0);
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
  return font;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const byte of b) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** An 8-bit grayscale PNG. `header-only` writes IHDR and IEND without pixel data (a huge claimed size at 60 bytes). */
export function buildPng(
  width: number,
  height: number,
  mode: 'solid' | 'header-only' = 'solid',
): Buffer {
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 0, 0, 0, 0])]);
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr)];
  if (mode === 'solid') {
    const raw = Buffer.alloc((width + 1) * height, 0xf0);
    for (let row = 0; row < height; row++) raw[row * (width + 1)] = 0;
    parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })));
  }
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** A JPEG with a valid marker structure and size but no scan data (enough for header checks). */
export function buildJpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0]),
    u16(16),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.from([1, 1, 0]),
    u16(1),
    u16(1),
    Buffer.from([0, 0]),
  ]);
  const sof = Buffer.concat([
    Buffer.from([0xff, 0xc0]),
    u16(11),
    Buffer.from([8]),
    u16(height),
    u16(width),
    Buffer.from([1, 1, 0x11, 0]),
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
export const GOOD_VIEW_BOX = '0 0 841.89 595.28';

export function svgDocument(
  body: string,
  options: { prolog?: string; viewBox?: string | null; extraAttributes?: string } = {},
): string {
  const viewBox = options.viewBox === null ? '' : ` viewBox="${options.viewBox ?? GOOD_VIEW_BOX}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${options.prolog ?? ''}<svg ${SVG_NS}${viewBox}${options.extraAttributes ?? ''}>\n${body}\n</svg>\n`;
}

const GOOD_BODY = `  <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e8eef7"/></linearGradient></defs>
  <rect width="841.89" height="595.28" fill="url(#g)"/>
  <rect x="30" y="30" width="781.89" height="535.28" fill="none" stroke="#1d3557" stroke-width="4"/>
  <path d="M120 200 H720" stroke="#1d3557" stroke-width="2"/>`;

export const GOOD_CONFIG = {
  engine: 'svg-pdf',
  page: { size: 'A4', orientation: 'landscape' },
  background: 'background.svg',
  images: [{ file: 'assets/logo.png', x: 320, y: 60, width: 200 }],
  fonts: { main: 'fonts/main.ttf' },
  fields: {
    ownerName: {
      x: 100,
      y: 250,
      width: 640,
      font: 'main',
      size: 36,
      color: '#1d3557',
      align: 'center',
      maxLines: 1,
    },
    subject: {
      x: 100,
      y: 330,
      width: 640,
      font: 'main',
      size: 20,
      color: '#333333',
      align: 'center',
      maxLines: 2,
    },
  },
  qr: { x: 700, y: 450, size: 100 },
};

export interface Fixture {
  path: string;
  content: Buffer | string;
}

/** Every committed fixture, relative to `test/fixtures/templates`. */
export function fixtures(): Fixture[] {
  const evil = (name: string, svg: string): Fixture => ({
    path: `malicious/${name}.svg`,
    content: svg,
  });
  const bomb = Array.from(
    { length: 9 },
    (_, i) =>
      `<!ENTITY lol${String(i + 1)} "${Array.from({ length: 10 }, () => (i === 0 ? 'lol' : `&lol${String(i)};`)).join('')}">`,
  ).join('\n  ');
  return [
    { path: 'good/config.json', content: `${JSON.stringify(GOOD_CONFIG, null, 2)}\n` },
    { path: 'good/background.svg', content: svgDocument(GOOD_BODY) },
    { path: 'good/assets/logo.png', content: buildPng(800, 400) },
    { path: 'good/fonts/main.ttf', content: buildFont(fontCharacters()) },
    evil(
      'xxe',
      svgDocument('<text>&xxe;</text>', {
        prolog: '<!DOCTYPE svg [\n  <!ENTITY xxe SYSTEM "file:///etc/passwd">\n]>\n',
      }),
    ),
    evil(
      'billion-laughs',
      svgDocument('<text>&lol9;</text>', { prolog: `<!DOCTYPE svg [\n  ${bomb}\n]>\n` }),
    ),
    evil('script', svgDocument('<script>alert(document.cookie)</script>')),
    evil('onload', svgDocument('<rect width="10" height="10" onload="alert(1)"/>')),
    evil(
      'external-href',
      svgDocument('<image href="https://example.com/track.png" width="10" height="10"/>'),
    ),
    evil(
      'foreign-object',
      svgDocument(
        '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
      ),
    ),
    evil('css-import', svgDocument('<style>@import url("https://example.com/a.css");</style>')),
    evil(
      'wrong-root',
      '<?xml version="1.0"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>\n',
    ),
    evil('text-element', svgDocument('<text x="10" y="20">Hello</text>')),
    { path: 'malicious/huge-image.png', content: buildPng(5000, 5000, 'header-only') },
    { path: 'malicious/png-renamed.jpg', content: buildPng(800, 400) },
    { path: 'malicious/empty.ttf', content: Buffer.alloc(0) },
    {
      path: 'malicious/garbage.ttf',
      content: Buffer.from('this is not a font at all, just text'.repeat(4)),
    },
    { path: 'malicious/no-schwa.ttf', content: buildFont(fontCharacters({ schwa: false })) },
    { path: 'malicious/no-cyrillic.ttf', content: buildFont(fontCharacters({ cyrillic: false })) },
  ];
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  for (const fixture of fixtures()) {
    const target = path.join(root, fixture.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, fixture.content);
    process.stdout.write(`wrote ${fixture.path}\n`);
  }
}
