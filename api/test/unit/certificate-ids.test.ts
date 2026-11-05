import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RandomIdGenerator } from '../../src/adapters/system/id-generator.js';
import { NotFoundError } from '../../src/shared/errors.js';
import { CERTIFICATE_ID_PATTERN, parseCertificateId } from '../../src/shared/ids.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn((size: number) => actual.randomBytes(size)) };
});

describe('RandomIdGenerator', () => {
  beforeEach(() => {
    vi.mocked(randomBytes).mockClear();
  });

  it('generates 100k unique 22-char IDs matching the public regex', () => {
    const gen = new RandomIdGenerator();
    const seen = new Set<string>();
    const badIds: string[] = [];
    for (let i = 0; i < 100_000; i += 1) {
      const id = gen.newCertificateId();
      if (id.length !== 22 || !CERTIFICATE_ID_PATTERN.test(id)) badIds.push(id);
      seen.add(id);
    }
    expect(badIds).toEqual([]);
    expect(seen.size).toBe(100_000);
  }, 30_000);

  it('draws 16 random bytes (128 bits of entropy) for certificate IDs and tokens', () => {
    const gen = new RandomIdGenerator();
    gen.newCertificateId();
    gen.newToken();
    const calls = vi.mocked(randomBytes).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [size] of calls) expect(size * 8).toBeGreaterThanOrEqual(128);
    expect(gen.newToken()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('parseCertificateId', () => {
  it('accepts new 22-char base64url and legacy 32-hex IDs', () => {
    expect(parseCertificateId('AAAAAAAAAAAAAAAAAAAAAA')).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(parseCertificateId('0123456789abcdef0123456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef',
    );
  });

  it.each([
    'A'.repeat(21),
    'A'.repeat(23),
    `${'A'.repeat(20)}+/`,
    `${'A'.repeat(21)}=`,
    '0123456789ABCDEF0123456789ABCDEF',
    '',
    ' '.repeat(22),
    undefined,
    42,
  ])('throws NotFoundError (same as unknown ID) for %j', (value) => {
    expect(() => parseCertificateId(value)).toThrow(NotFoundError);
  });
});
