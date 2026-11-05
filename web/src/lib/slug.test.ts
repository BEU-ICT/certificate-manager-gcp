import { describe, expect, it } from 'vitest';
import { isValidSlug, slugify, SLUG_MAX_LENGTH } from './slug';

describe('slugify (mirrors the API)', () => {
  it.each([
    ['Əhməd Təşkilat', 'ehmed-teskilat'],
    ['Şəki', 'seki'],
    ['İstanbul', 'istanbul'],
    ['Iğdır', 'igdir'],
    ['Москва  Центр', 'moskva-tsentr'],
    ['  --Acme, Inc.!  ', 'acme-inc'],
    ['Straße', 'strasse'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('🎉🎉')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('cuts long input at a hyphen boundary within the limit', () => {
    const slug = slugify('alpha beta gamma delta epsilon zeta eta theta iota kappa');
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
    expect('alpha-beta-gamma-delta-epsilon-zeta-eta-theta-iota-kappa'.startsWith(slug)).toBe(true);
  });
});

describe('isValidSlug', () => {
  it('accepts kebab-case of 2 to 40 characters', () => {
    expect(isValidSlug('ab')).toBe(true);
    expect(isValidSlug('acme-2')).toBe(true);
  });
  it('rejects everything else', () => {
    for (const bad of ['a', 'A-b', 'a--b', '-ab', 'ab-', 'a_b', 'x'.repeat(41), 1, null]) {
      expect(isValidSlug(bad)).toBe(false);
    }
  });
});
