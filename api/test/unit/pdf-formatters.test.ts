import { describe, expect, it } from 'vitest';
import { KNOWN_FORMATS } from '../../src/modules/templates/index.js';
import {
  FormatterError,
  FormatterRegistry,
  TEMPLATE_TIMEZONE,
} from '../../src/modules/pdf/formatters.js';
import { createFormatterRegistry } from '../../src/modules/pdf/formatters-builtin.js';
import { assertFormatterRuntime } from '../../src/modules/pdf/formatters-selfcheck.js';

const az = { locale: 'az' };
const en = { locale: 'en' };
const registry = createFormatterRegistry();
const fmt = (name: string, value: unknown, ctx = az): string => registry.format(name, value, ctx);

describe('formatter registry vs KNOWN_FORMATS', () => {
  it('registers exactly the known formats with matching kinds', () => {
    expect([...registry.names()].sort()).toEqual(Object.keys(KNOWN_FORMATS).sort());
    for (const [name, kind] of Object.entries(KNOWN_FORMATS)) {
      expect(registry.kindOf(name)).toBe(kind);
    }
  });
});

describe('registration', () => {
  it('lets a test add a formatter without touching existing files', () => {
    const r = createFormatterRegistry();
    r.register('shout', (v: string) => `${v}!`, { appliesTo: 'text' });
    expect(r.format('shout', 'hi', en)).toBe('hi!');
    expect(r.kindOf('shout')).toBe('text');
    expect(r.has('shout')).toBe(true);
  });

  it('rejects duplicates, empty names, unknown formatters and wrong value kinds', () => {
    const r = new FormatterRegistry();
    r.register('x', (v: string) => v, { appliesTo: 'text' });
    expect(() => r.register('x', (v: string) => v, { appliesTo: 'text' })).toThrow(FormatterError);
    expect(() => r.register('', (v: string) => v, { appliesTo: 'text' })).toThrow(FormatterError);
    expect(() => r.format('nope', 'a', en)).toThrow(/Unknown formatter/);
    expect(() => r.format('x', 5, en)).toThrow(/expects a text/);
    expect(() => registry.format('list-comma', 'a,b', en)).toThrow(/expects a list/);
    expect(() => registry.format('list-comma', [1], en)).toThrow(/expects a list/);
    expect(() => registry.format('date-iso', 5, en)).toThrow(/expects a date/);
    expect(registry.kindOf('nope')).toBeUndefined();
  });
});

describe('casing', () => {
  it('text is returned as is', () => {
    expect(fmt('text', '  Əli  İ ', az)).toBe('  Əli  İ ');
  });

  it('az: dotted/dotless i', () => {
    expect(fmt('uppercase', 'istanbul', az)).toBe('İSTANBUL');
    expect(fmt('lowercase', 'ISTANBUL', az)).toBe('ıstanbul');
    expect(fmt('lowercase', 'İSTANBUL', az)).toBe('istanbul');
    expect(fmt('uppercase', 'ıspanaq', az)).toBe('ISPANAQ');
    expect(fmt('uppercase', 'əli çınar şəmsi ğ ö ü', az)).toBe('ƏLİ ÇINAR ŞƏMSİ Ğ Ö Ü');
  });

  it('en: plain rules and regional tags', () => {
    expect(fmt('uppercase', 'istanbul', en)).toBe('ISTANBUL');
    expect(fmt('lowercase', 'ISTANBUL', en)).toBe('istanbul');
    expect(fmt('uppercase', 'istanbul', { locale: 'az-AZ' })).toBe('İSTANBUL');
    expect(fmt('uppercase', 'istanbul', { locale: 'de' })).toBe('ISTANBUL');
  });

  it('titlecase handles words, hyphens, mixed case, empty and az i', () => {
    expect(fmt('titlecase', 'əli məmmədov', az)).toBe('Əli Məmmədov');
    expect(fmt('titlecase', 'İSMAYIL ıSAYEV', az)).toBe('İsmayıl Isayev');
    expect(fmt('titlecase', 'ismayil', az)).toBe('İsmayil');
    expect(fmt('titlecase', 'ismayil', en)).toBe('Ismayil');
    expect(fmt('titlecase', 'jean-luc PICARD', en)).toBe('Jean-Luc Picard');
    expect(fmt('titlecase', "don't stop", en)).toBe("Don't Stop");
    expect(fmt('titlecase', '', en)).toBe('');
  });
});

describe('dates (Asia/Baku)', () => {
  it('uses Asia/Baku', () => {
    expect(TEMPLATE_TIMEZONE).toBe('Asia/Baku');
  });

  it('formats the three styles', () => {
    const d = new Date('2026-11-04T10:15:30.000Z');
    expect(fmt('date-dmy', d)).toBe('04.11.2026');
    expect(fmt('date-iso', d)).toBe('2026-11-04');
    expect(fmt('date-long', d, az)).toBe('4 noyabr 2026');
    expect(fmt('date-long', d, en)).toBe('4 November 2026');
  });

  it('accepts ISO strings', () => {
    expect(fmt('date-iso', '2026-11-04T10:15:30.000Z')).toBe('2026-11-04');
  });

  it('23:30 UTC shows the next Baku day, 19:59 UTC does not', () => {
    expect(fmt('date-dmy', '2026-11-03T23:30:00.000Z')).toBe('04.11.2026');
    expect(fmt('date-iso', '2026-11-03T23:30:00.000Z')).toBe('2026-11-04');
    expect(fmt('date-long', '2026-11-03T23:30:00.000Z', az)).toBe('4 noyabr 2026');
    expect(fmt('date-iso', '2026-11-03T19:59:59.999Z')).toBe('2026-11-03');
    expect(fmt('date-iso', '2026-11-03T20:00:00.000Z')).toBe('2026-11-04');
  });

  it('crosses the year boundary', () => {
    expect(fmt('date-iso', '2025-12-31T21:00:00.000Z')).toBe('2026-01-01');
  });

  it('handles leap days', () => {
    expect(fmt('date-dmy', '2028-02-29T12:00:00.000Z')).toBe('29.02.2028');
    expect(fmt('date-iso', '2028-02-28T20:30:00.000Z')).toBe('2028-02-29');
    expect(fmt('date-long', '2028-02-29T12:00:00.000Z', en)).toBe('29 February 2028');
    expect(fmt('date-iso', '2028-02-29T20:30:00.000Z')).toBe('2028-03-01');
  });

  it('rejects invalid dates', () => {
    expect(() => fmt('date-iso', 'not a date')).toThrow(FormatterError);
    expect(() => fmt('date-dmy', new Date(NaN))).toThrow(FormatterError);
  });
});

describe('list-comma', () => {
  it('joins with ", "', () => {
    expect(fmt('list-comma', ['Node', 'Əlaqə', 'İdarə'])).toBe('Node, Əlaqə, İdarə');
    expect(fmt('list-comma', ['one'])).toBe('one');
  });

  it('returns an empty string for an empty list', () => {
    expect(fmt('list-comma', [])).toBe('');
  });
});

describe('assertFormatterRuntime', () => {
  it('passes on this Node build', () => {
    expect(() => assertFormatterRuntime()).not.toThrow();
  });
});
