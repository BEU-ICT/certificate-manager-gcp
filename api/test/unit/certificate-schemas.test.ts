import { describe, expect, it } from 'vitest';
import { emailInitialStatus, isRevoked } from '../../src/modules/certificates/domain.js';
import {
  certificateContentShape,
  emailSchema,
  issuedAtSchema,
  optionalEmailSchema,
  ownerNameSchema,
  skillsSchema,
  subjectSchema,
} from '../../src/modules/certificates/schemas.js';
import { CERTIFICATE_TYPES, isCertificateType } from '../../src/shared/certificate-types.js';
import { z } from 'zod';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const now = () => NOW;

describe('text fields', () => {
  it.each([
    ['ownerName', ownerNameSchema, 120],
    ['subject', subjectSchema, 200],
  ])('%s boundary lengths', (_n, schema, max) => {
    expect(schema.safeParse('a').success).toBe(true);
    expect(schema.safeParse('a'.repeat(max)).success).toBe(true);
    expect(schema.safeParse('a'.repeat(max + 1)).success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
    expect(schema.safeParse('   ').success).toBe(false);
  });

  it('trims, collapses whitespace and replaces control characters and newlines', () => {
    expect(ownerNameSchema.parse('  Ada \t  Lovelace\n\r\nJr ')).toBe('Ada Lovelace Jr');
  });

  it('strips zero-width and bidi characters (no spoofed names)', () => {
    expect(ownerNameSchema.parse('Ad​a‮ Love⁦lace‏﻿')).toBe('Ada Lovelace');
    expect(ownerNameSchema.safeParse('‮​').success).toBe(false);
  });

  it('NFC-normalises', () => {
    expect(ownerNameSchema.parse('é')).toBe('é');
  });

  it('counts emoji as code points and handles 10k characters without throwing', () => {
    expect(ownerNameSchema.safeParse('😀'.repeat(120)).success).toBe(true);
    expect(ownerNameSchema.safeParse('😀'.repeat(121)).success).toBe(false);
    expect(subjectSchema.safeParse('x'.repeat(10_000)).success).toBe(false);
    expect(skillsSchema.safeParse(['x'.repeat(10_000)]).success).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(ownerNameSchema.safeParse(42).success).toBe(false);
    expect(ownerNameSchema.safeParse(null).success).toBe(false);
  });
});

describe('email', () => {
  it('lowercases and trims', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects invalid and over-long addresses, accepts exactly 254', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    const local = 'a'.repeat(64);
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    const long = `${local}@${domain}`;
    expect(long.length).toBe(254);
    expect(emailSchema.safeParse(long).success).toBe(true);
    expect(emailSchema.safeParse(`a${long}`).success).toBe(false);
    expect(emailSchema.safeParse('a@b.co' + 'x'.repeat(10_000)).success).toBe(false);
  });

  it('optional variant treats absent and blank as no e-mail', () => {
    expect(optionalEmailSchema.parse(undefined)).toBeUndefined();
    expect(optionalEmailSchema.parse('  ')).toBeUndefined();
    expect(optionalEmailSchema.parse('A@B.io')).toBe('a@b.io');
    expect(optionalEmailSchema.safeParse('nope').success).toBe(false);
  });
});

describe('skills', () => {
  it('deduplicates case-insensitively keeping the first spelling', () => {
    expect(skillsSchema.parse(['TypeScript', ' typescript ', 'Go', 'GO', 'Rust'])).toEqual([
      'TypeScript',
      'Go',
      'Rust',
    ]);
  });

  it('enforces 10 items and 40 characters per item', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `s${String(i)}`);
    expect(skillsSchema.safeParse(ten).success).toBe(true);
    expect(skillsSchema.safeParse([...ten, 'extra']).success).toBe(false);
    expect(skillsSchema.safeParse(['a'.repeat(40)]).success).toBe(true);
    expect(skillsSchema.safeParse(['a'.repeat(41)]).success).toBe(false);
    expect(skillsSchema.safeParse(['']).success).toBe(false);
    expect(skillsSchema.safeParse(Array.from({ length: 101 }, () => 'a')).success).toBe(false);
  });

  it('reports the index of the failing item', () => {
    const r = skillsSchema.safeParse(['ok', '']);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual([1]);
  });

  it('counts duplicates once toward the limit', () => {
    const items = [...Array.from({ length: 10 }, (_, i) => `s${String(i)}`), 'S0', 'S1'];
    expect(skillsSchema.parse(items)).toHaveLength(10);
  });
});

describe('issuedAt', () => {
  const schema = issuedAtSchema(now);

  it('accepts the past and up to 5 minutes in the future', () => {
    expect(schema.parse('1999-01-01T00:00:00.000Z')).toEqual(new Date('1999-01-01T00:00:00.000Z'));
    expect(schema.safeParse('2026-11-05T12:05:00.000Z').success).toBe(true);
    expect(schema.safeParse(new Date(NOW.getTime() + 300_000)).success).toBe(true);
  });

  it('rejects more than 5 minutes in the future', () => {
    expect(schema.safeParse('2026-11-05T12:05:00.001Z').success).toBe(false);
    expect(schema.safeParse('2030-01-01T00:00:00.000Z').success).toBe(false);
  });

  it('rejects malformed values', () => {
    expect(schema.safeParse('yesterday').success).toBe(false);
    expect(schema.safeParse('2026-13-45T00:00:00Z').success).toBe(false);
    expect(schema.safeParse(new Date('invalid')).success).toBe(false);
    expect(schema.safeParse(1730000000000).success).toBe(false);
  });
});

describe('type registry and content shape', () => {
  it('contains the closed list of lowercase hyphen-free tokens', () => {
    expect([...CERTIFICATE_TYPES]).toEqual([
      'attendance',
      'appreciation',
      'thanks',
      'distinction',
      'instructor',
      'student',
      'team',
      'other',
    ]);
    for (const t of CERTIFICATE_TYPES) expect(t).toMatch(/^[a-z]+$/);
    expect(isCertificateType('thanks')).toBe(true);
    expect(isCertificateType('Thanks')).toBe(false);
    expect(isCertificateType(1)).toBe(false);
  });

  it('is usable in a strict object shared by single and bulk requests', () => {
    const schema = z.strictObject(certificateContentShape(now));
    const parsed = schema.parse({
      ownerName: ' Ada  Lovelace ',
      email: 'ADA@example.com',
      subject: 'Analytical Engines',
      issuedAt: '2026-11-01T00:00:00.000Z',
      type: 'attendance',
    });
    expect(parsed).toMatchObject({
      ownerName: 'Ada Lovelace',
      email: 'ada@example.com',
      skills: [],
    });
    expect(schema.safeParse({ ...parsed, type: 'bogus' }).success).toBe(false);
    expect(schema.safeParse({ ...parsed, status: 'revoked' }).success).toBe(false);
  });
});

describe('domain helpers', () => {
  it('isRevoked', () => {
    expect(isRevoked({ status: 'revoked' })).toBe(true);
    expect(isRevoked({ status: 'active' })).toBe(false);
  });

  it('emailInitialStatus', () => {
    expect(emailInitialStatus({ email: 'a@b.co' })).toBe('pending');
    expect(emailInitialStatus({})).toBe('skipped');
    expect(emailInitialStatus({ email: '' })).toBe('skipped');
  });
});
