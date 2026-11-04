import { describe, expect, it } from 'vitest';
import {
  asCertificateId,
  asTemplateRef,
  isCertificateId,
  isOrganizationId,
  isTemplateRef,
} from '../../src/shared/ids.js';

describe('ids', () => {
  it('accepts 22-char base64url and 32-char lowercase hex certificate IDs', () => {
    expect(isCertificateId('AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(isCertificateId('abc_-ABCabc_-ABCabc_-A')).toBe(true);
    expect(isCertificateId('0123456789abcdef0123456789abcdef')).toBe(true);
  });

  it.each([
    '',
    'short',
    '0123456789ABCDEF0123456789ABCDEF',
    'AAAAAAAAAAAAAAAAAAAAA!',
    'AAAAAAAAAAAAAAAAAAAAAAA',
    42,
    null,
  ])('rejects invalid certificate ID %j', (value) => {
    expect(isCertificateId(value)).toBe(false);
    expect(() => asCertificateId(value)).toThrow(TypeError);
  });

  it('validates template references', () => {
    expect(isTemplateRef('acme-devfest-attendance-v1')).toBe(true);
    expect(isTemplateRef('a-v0')).toBe(true);
    expect(isTemplateRef('a-v01')).toBe(false);
    expect(isTemplateRef('Acme-v1')).toBe(false);
    expect(isTemplateRef('acme_v1')).toBe(false);
    expect(asTemplateRef('x-v2')).toBe('x-v2');
  });

  it('validates opaque entity IDs', () => {
    expect(isOrganizationId('abc123')).toBe(true);
    expect(isOrganizationId('a/b')).toBe(false);
    expect(isOrganizationId('')).toBe(false);
  });
});
