import { describe, expect, it } from 'vitest';
import { parseCertificateFile } from './index';
import { headerKey, matchHeader } from './headers';
import { detectDelimiter, parseCsv } from './csv';
import {
  buildCsvTemplate,
  buildXlsxTemplate,
  TEMPLATE_HEADERS,
  TEMPLATE_FILE_NAMES,
} from './template';
import { buildXlsx, type XlsxCell } from './xlsxWriter';
import { MAX_DATA_ROWS, MAX_UNCOMPRESSED_BYTES } from './limits';
import { strToU8, zipSync } from 'fflate';
import type { ParseOutcome } from './types';

const NOW = new Date(2026, 10, 9, 12, 0, 0);
const HEADER = ['ownerName', 'email', 'subject', 'skills', 'issuedAt'];

const csvFile = (text: string, name = 'in.csv', bom = false) =>
  new File([bom ? '﻿' + text : text], name, { type: 'text/csv' });
const xlsxFile = (rows: XlsxCell[][], name = 'in.xlsx') =>
  new File([buildXlsx(rows).slice().buffer], name);
const parse = (file: File) => parseCertificateFile(file, { now: NOW });

function ok(outcome: ParseOutcome) {
  if (!outcome.ok) throw new Error(`blocked: ${outcome.error.code}`);
  return outcome;
}

describe('csv helpers', () => {
  it('detects the delimiter outside quotes', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n')).toBe('\t');
    expect(detectDelimiter('"a;b;c",d,e\n')).toBe(',');
    expect(detectDelimiter('single\n')).toBe(',');
    expect(detectDelimiter('\n\na;b\n')).toBe(';');
  });
  it('parses quotes, escapes, embedded breaks and every line ending', () => {
    expect(parseCsv('a,"b ""q"", c","d\ne"\r\nx,,z\ry', ',')).toEqual([
      ['a', 'b "q", c', 'd\ne'],
      ['x', '', 'z'],
      ['y'],
    ]);
  });
});

describe('headers', () => {
  it('matches aliases case-insensitively, including Azerbaijani casing', () => {
    expect(matchHeader('  OWNERNAME ')).toBe('ownerName');
    expect(matchHeader('Full Name')).toBe('ownerName');
    expect(matchHeader('AD SOYAD')).toBe('ownerName');
    expect(matchHeader('Ad, Soyad')).toBe('ownerName');
    expect(matchHeader('E-POÇT')).toBe('email');
    expect(matchHeader('MÖVZU')).toBe('subject');
    expect(matchHeader('BACARIQLAR')).toBe('skills');
    expect(matchHeader('Bacarıqlar')).toBe('skills');
    expect(matchHeader('TARİX')).toBe('issuedAt');
    expect(matchHeader('Activity')).toBe('subject');
    expect(matchHeader('phone')).toBeUndefined();
    expect(headerKey('İ')).toBe('i');
  });
});

describe('csv files', () => {
  it('reads a BOM-prefixed semicolon CSV with CRLF and quoted fields', async () => {
    const text = [
      'Ad Soyad;E-poçt;Mövzu;Bacarıqlar;Tarix',
      'Aysel Məmmədova;AYSEL@Example.com;"Cloud; the ""basics""";JS, React;14.05.2026',
      '',
      'Иван Петров;;Семинар;;2026-05-15',
    ].join('\r\n');
    const out = ok(await parse(csvFile(text, 'in.csv', true)));
    expect(out.columns).toEqual(['ownerName', 'email', 'subject', 'skills', 'issuedAt']);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toEqual({
      rowNumber: 2,
      errors: [],
      values: {
        ownerName: 'Aysel Məmmədova',
        email: 'aysel@example.com',
        subject: 'Cloud; the "basics"',
        skills: ['JS', 'React'],
        issuedAt: '2026-05-14',
      },
    });
    expect(out.rows[1]?.rowNumber).toBe(4);
    expect(out.rows[1]?.values.ownerName).toBe('Иван Петров');
    expect(out.rows[1]?.errors).toEqual([]);
  });

  it('keeps UTF-8 letters intact without a BOM, with tab delimiters and LF', async () => {
    const text = 'name\tsubject\tdate\nƏliyev Çingiz Ğ\tŞəbəkə ıİ öü\t2026-01-02\n';
    const out = ok(await parse(csvFile(text)));
    expect(out.rows[0]?.values.ownerName).toBe('Əliyev Çingiz Ğ');
    expect(out.rows[0]?.values.subject).toBe('Şəbəkə ıİ öü');
  });

  it('rejects input that is not UTF-8', async () => {
    const bytes = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0xe9, 0xff]);
    const out = await parse(new File([bytes], 'latin.csv'));
    expect(out).toEqual({ ok: false, error: { code: 'invalidEncoding' } });
  });

  it('notices unknown and duplicate columns and absent optional columns', async () => {
    const out = ok(await parse(csvFile('name,Full Name,phone,subject\nAnna,Bob,1,Talk\n')));
    expect(out.notices).toEqual([
      { code: 'duplicateColumn', column: 'Full Name' },
      { code: 'unknownColumn', column: 'phone' },
      { code: 'missingColumn', column: 'email' },
      { code: 'missingColumn', column: 'skills' },
      { code: 'missingColumn', column: 'issuedAt' },
    ]);
    // the first of two duplicate headers wins; absent columns are not validated
    expect(out.rows[0]?.values.ownerName).toBe('Anna');
    expect(out.rows[0]?.errors).toEqual([]);
  });

  it('blocks a file without an ownerName column or without content', async () => {
    expect(await parse(csvFile('email,subject\na@b.co,x\n'))).toEqual({
      ok: false,
      error: { code: 'missingOwnerName' },
    });
    expect(await parse(csvFile('\n\n  \n'))).toEqual({ ok: false, error: { code: 'empty' } });
  });

  it('treats cells starting with = + - @ as plain text', async () => {
    const text = ['name,subject', '=HYPERLINK("x"),+1 talk', '@admin,-minus', ''].join('\n');
    const out = ok(await parse(csvFile(text)));
    expect(out.rows.map((r) => r.values.ownerName)).toEqual(['=HYPERLINK("x")', '@admin']);
    expect(out.rows.map((r) => r.values.subject)).toEqual(['+1 talk', '-minus']);
  });
});

describe('row validation', () => {
  it('applies the server rules and reports the sheet row number', async () => {
    const long = 'x'.repeat(121);
    const skills = Array.from({ length: 11 }, (_, i) => `s${String(i)}`).join(';');
    const text = [
      HEADER.join(','),
      `${long},not-an-email,,${skills},31.02.2026`,
      `Ok Name,,Talk,,2999-01-01`,
      `Ok,,Talk,"A;a;${'y'.repeat(41)}",`,
    ].join('\n');
    const out = ok(await parse(csvFile(text)));
    const codes = (i: number) => out.rows[i]?.errors.map((e) => `${e.field}:${e.code}`);
    expect(codes(0)).toEqual([
      'ownerName:tooLong',
      'subject:required',
      'email:invalid',
      'skills:tooMany',
      'issuedAt:invalid',
    ]);
    expect(out.rows[0]?.errors[0]).toMatchObject({ max: 120 });
    expect(codes(1)).toEqual(['issuedAt:future']);
    expect(codes(2)).toEqual(['skills:tooLong', 'issuedAt:required']);
    expect(out.rows[2]?.rowNumber).toBe(4);
  });

  it('treats e-mails that normalise to blank as absent, like the server', async () => {
    const text = `${HEADER.join(',')}\nA,"\u0001\u0002",Talk,,2026-11-09\nB,"\u200b ",Talk,,2026-11-09\n`;
    const out = ok(await parse(csvFile(text)));
    expect(out.rows.map((r) => r.errors)).toEqual([[], []]);
    expect(out.rows.map((r) => r.values.email)).toEqual(['', '']);
  });

  it('reads a digits-only date text as an Excel serial, not a year', async () => {
    const text = `${HEADER.join(',')}\nA,,Talk,,2024\n`;
    const out = ok(await parse(csvFile(text)));
    expect(out.rows[0]?.values.issuedAt).toBe('1905-07-16');
    expect(out.rows[0]?.errors).toEqual([]);
  });

  it('trims, collapses whitespace, dedupes skills and accepts today', async () => {
    const text = `${HEADER.join(',')}\n"  Ada \n  Lovelace  ", ,  Talk ,"Go; go ; Rust",2026-11-09\n`;
    const out = ok(await parse(csvFile(text)));
    expect(out.rows[0]?.errors).toEqual([]);
    expect(out.rows[0]?.values).toEqual({
      ownerName: 'Ada Lovelace',
      email: '',
      subject: 'Talk',
      skills: ['Go', 'Rust'],
      issuedAt: '2026-11-09',
    });
  });
});

describe('xlsx files', () => {
  it('reads the first sheet with date serials, Date cells, aliases and trailing blanks', async () => {
    const out = ok(
      await parse(
        xlsxFile([
          ['Full name', 'E-mail', 'Activity', 'Skills', 'Date', null, null],
          ['Əli Vəliyev', 'ali@example.com', 'Talk', 'A;B', { serial: 46156 }, null, null], // 2026-05-14
          [null, null, null, null, null],
          ['Иван', null, 'Семинар', null, 46157, null],
          ['Text date', null, 'Talk', null, '15.05.2026'],
        ]),
      ),
    );
    expect(out.format).toBe('xlsx');
    expect(out.notices).toEqual([]);
    expect(out.rows.map((r) => [r.rowNumber, r.values.issuedAt, r.errors.length])).toEqual([
      [2, '2026-05-14', 0],
      [4, '2026-05-15', 0],
      [5, '2026-05-15', 0],
    ]);
    expect(out.rows[0]?.values.ownerName).toBe('Əli Vəliyev');
    expect(out.rows[1]?.values.ownerName).toBe('Иван');
  });

  it('uses the cached value of formulas and never evaluates them', async () => {
    const out = ok(
      await parse(
        xlsxFile([
          ['ownerName', 'subject', 'issuedAt'],
          [
            { formula: 'CONCATENATE("A","B")', cached: 'AB' },
            '=1+1',
            { formula: 'TODAY()', cached: 46156 },
          ],
        ]),
      ),
    );
    expect(out.rows[0]?.values).toMatchObject({
      ownerName: 'AB',
      subject: '=1+1',
      issuedAt: '2026-05-14',
    });
    expect(out.rows[0]?.errors).toEqual([]);
  });

  it('flags impossible serials as invalid dates', async () => {
    const out = ok(
      await parse(
        xlsxFile([
          ['ownerName', 'issuedAt'],
          ['A', -5],
          ['B', 99999999],
        ]),
      ),
    );
    expect(out.rows.map((r) => r.errors[0]?.code)).toEqual(['invalid', 'invalid']);
  });

  it('rejects a zip bomb before inflating it', async () => {
    // ~60 MB of zeros deflates to a few tens of KB.
    const bomb = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/worksheets/sheet1.xml': new Uint8Array(MAX_UNCOMPRESSED_BYTES + 10 * 1024 * 1024),
    });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(await parse(new File([bomb.slice().buffer], 'bomb.xlsx'))).toEqual({
      ok: false,
      error: { code: 'tooLarge', limit: MAX_UNCOMPRESSED_BYTES },
    });
  });

  it('rejects files that are not real workbooks', async () => {
    const out = await parse(new File(['hello'], 'fake.xlsx'));
    expect(out).toEqual({ ok: false, error: { code: 'invalidFile' } });
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    expect(await parse(new File([ole], 'old.xlsx'))).toEqual({
      ok: false,
      error: { code: 'legacyXls' },
    });
    const zipNoSheet = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    expect(await parse(new File([zipNoSheet], 'bad.xlsx'))).toEqual({
      ok: false,
      error: { code: 'invalidFile' },
    });
  });
});

describe('limits', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => `Person ${String(i + 1)},Talk,2026-05-14`).join('\n');

  it('accepts 5 000 rows within 3 seconds and rejects 5 001', async () => {
    const started = performance.now();
    const out = ok(await parse(csvFile(`name,subject,date\n${rows(MAX_DATA_ROWS)}\n`)));
    expect(out.rows).toHaveLength(5000);
    expect(out.rows[4999]?.rowNumber).toBe(5001);
    expect(performance.now() - started).toBeLessThan(3000);

    const tooMany = await parse(csvFile(`name,subject,date\n${rows(MAX_DATA_ROWS + 1)}\n`));
    expect(tooMany).toEqual({ ok: false, error: { code: 'tooManyRows', limit: 5000 } });
  });

  it('accepts 5 000 rows in an xlsx within 3 seconds and rejects 5 001', async () => {
    const sheet = (n: number): XlsxCell[][] => [
      ['name', 'subject', 'date'],
      ...Array.from({ length: n }, (_, i): XlsxCell[] => [
        `P ${String(i)}`,
        'Talk',
        { serial: 46156 },
      ]),
    ];
    const started = performance.now();
    const out = ok(await parse(xlsxFile(sheet(5000))));
    expect(out.rows).toHaveLength(5000);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(await parse(xlsxFile(sheet(5001)))).toEqual({
      ok: false,
      error: { code: 'tooManyRows', limit: 5000 },
    });
  });

  it('rejects more than 20 columns', async () => {
    const wide = Array.from({ length: 21 }, (_, i) => `c${String(i)}`);
    wide[0] = 'name';
    expect(await parse(csvFile(wide.join(',') + '\nx\n'))).toEqual({
      ok: false,
      error: { code: 'tooManyColumns', limit: 20 },
    });
    const twenty = wide.slice(0, 20);
    ok(await parse(csvFile(twenty.join(',') + '\nx\n')));
  });

  it('rejects by name and size before reading the file', async () => {
    expect(await parse(new File(['x'], 'a.xls'))).toEqual({
      ok: false,
      error: { code: 'legacyXls' },
    });
    expect(await parse(new File(['x'], 'a.XLSM'))).toEqual({
      ok: false,
      error: { code: 'macroEnabled' },
    });
    expect(await parse(new File(['x'], 'a.txt'))).toEqual({
      ok: false,
      error: { code: 'unsupportedType' },
    });
    const big = new File(['x'], 'big.csv');
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    const spy = (big.arrayBuffer = () => Promise.reject(new Error('must not be read')));
    expect(spy).toBeDefined();
    expect(await parse(big)).toEqual({ ok: false, error: { code: 'tooLarge', limit: 5242880 } });
  });
});

describe('worker dispatch', () => {
  it('parses files above 1 MB in a Web Worker and falls back when it cannot start', async () => {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: ((e: { data: ParseOutcome }) => void) | null = null;
      onerror: ((e: { message: string }) => void) | null = null;
      static fail = false;
      postMessage(msg: unknown) {
        posted.push(msg);
        queueMicrotask(() =>
          FakeWorker.fail
            ? this.onerror?.({ message: 'blocked' })
            : this.onmessage?.({ data: { ok: false, error: { code: 'empty' } } }),
        );
      }
      terminate() {}
    }
    const original = globalThis.Worker;
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    try {
      const pad = ' '.repeat(1024 * 1024 + 1);
      const big = csvFile(`name\nAnna\n${pad}\n`);
      expect(await parse(big)).toEqual({ ok: false, error: { code: 'empty' } });
      expect(posted).toHaveLength(1);

      FakeWorker.fail = true;
      const out = ok(await parse(big));
      expect(out.rows[0]?.values.ownerName).toBe('Anna');
      expect(posted).toHaveLength(2);

      // small files never start a worker
      FakeWorker.fail = false;
      ok(await parse(csvFile('name\nAnna\n')));
      expect(posted).toHaveLength(2);
    } finally {
      globalThis.Worker = original;
    }
  });
});

describe('templates', () => {
  const read = async (blob: Blob, name: string) =>
    ok(await parse(new File([await blob.arrayBuffer()], name)));

  it.each(['en', 'az'] as const)('round-trips the %s CSV and XLSX templates', async (lang) => {
    expect(TEMPLATE_FILE_NAMES).toEqual({
      xlsx: 'certificates-template.xlsx',
      csv: 'certificates-template.csv',
    });
    const csv = await read(buildCsvTemplate(lang), 'certificates-template.csv');
    const xlsx = await read(await buildXlsxTemplate(lang), 'certificates-template.xlsx');
    for (const out of [csv, xlsx]) {
      expect(out.notices).toEqual([]);
      expect(out.columns).toEqual(['ownerName', 'email', 'subject', 'skills', 'issuedAt']);
      expect(out.rows).toHaveLength(2);
      expect(out.rows.flatMap((r) => r.errors)).toEqual([]);
      expect(out.rows[0]?.values.skills.length).toBe(2);
    }
    expect(csv.rows).toEqual(xlsx.rows);
    expect(Object.values(TEMPLATE_HEADERS[lang])).toHaveLength(5);
  });

  it('starts the CSV template with a UTF-8 BOM', async () => {
    const bytes = new Uint8Array(await buildCsvTemplate('az').arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
