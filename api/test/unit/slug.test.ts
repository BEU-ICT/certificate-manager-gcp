import { describe, expect, it } from 'vitest';
import { isValidSlug, slugify, withSuffix } from '../../src/shared/slug.js';

describe('slugify', () => {
  it.each([
    ['Əhməd', 'ehmed'],
    ['Şəki', 'seki'],
    ['Ağdam', 'agdam'],
    ['İstanbul', 'istanbul'],
    ['Iğdır', 'igdir'],
    ['ÇİÇƏK ÖLKƏSİ Üzüm', 'cicek-olkesi-uzum'],
    ['Москва 2026', 'moskva-2026'],
    ['Щука & Ёж', 'shchuka-ezh'],
    ['Ҹәмил Ҝүлмәммәдов', 'cemil-gulmemmedov'],
    ['  DevFest   2026!  ', 'devfest-2026'],
    ['a--b__c', 'a-b-c'],
    ['Straße', 'strasse'],
    ['--Hello--', 'hello'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
    expect(isValidSlug(expected)).toBe(true);
  });

  it.each(['', '   ', '🎉🎉🎉', '!!!???', '---', '日本語'])('%j yields nothing usable', (input) => {
    expect(slugify(input)).toBe('');
  });

  it('a single character is produced but is not a valid slug', () => {
    expect(slugify('A')).toBe('a');
    expect(isValidSlug('a')).toBe(false);
  });

  it('cuts long names on a hyphen boundary within 40 characters', () => {
    const slug = slugify(
      'Annual International Conference on Information and Communication Technologies',
    );
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toBe('annual-international-conference-on');
    expect(isValidSlug(slug)).toBe(true);
  });

  it('hard-cuts a very long single word and never ends with a hyphen', () => {
    const slug = slugify('x'.repeat(100));
    expect(slug).toHaveLength(40);
    expect(slugify(`${'a'.repeat(39)}-b`)).toBe('a'.repeat(39));
  });

  it('is idempotent on valid slugs', () => {
    for (const s of ['devfest-2026', 'ab', 'a-b-c']) expect(slugify(s)).toBe(s);
  });
});

describe('isValidSlug', () => {
  it.each(['ab', 'devfest-2026', 'a1', '0-1'])('accepts %s', (s) =>
    expect(isValidSlug(s)).toBe(true),
  );
  it.each(['', 'a', 'A-b', 'a--b', '-ab', 'ab-', 'a b', 'ə', 'x'.repeat(41), 42, null])(
    'rejects %j',
    (s) => expect(isValidSlug(s)).toBe(false),
  );
});

describe('withSuffix', () => {
  it('appends -n', () => expect(withSuffix('acme', 2)).toBe('acme-2'));
  it('shortens the base to stay within 40 characters', () => {
    const slug = withSuffix('a'.repeat(40), 12);
    expect(slug).toHaveLength(40);
    expect(slug.endsWith('-12')).toBe(true);
    expect(isValidSlug(slug)).toBe(true);
  });
});
