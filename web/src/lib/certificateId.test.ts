import { describe, expect, it } from 'vitest';
import { isCertificateId, parseCertificateInput } from './certificateId';

const NEW_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const LEGACY = '0123456789abcdef0123456789abcdef';

describe('parseCertificateInput', () => {
  it('accepts new and legacy IDs, trimmed', () => {
    expect(parseCertificateInput(`  ${NEW_ID}\n`)).toBe(NEW_ID);
    expect(parseCertificateInput(LEGACY)).toBe(LEGACY);
  });

  it('extracts the last path segment of pasted URLs', () => {
    expect(parseCertificateInput(`https://example.org/c/${NEW_ID}`)).toBe(NEW_ID);
    expect(parseCertificateInput(`https://example.org/c/${NEW_ID}/?lang=en#x`)).toBe(NEW_ID);
    expect(parseCertificateInput(`/c/${LEGACY}`)).toBe(LEGACY);
  });

  it.each([
    '',
    '   ',
    'abc',
    `${NEW_ID}x`,
    'https://example.org/',
    'https://example.org/c/abc',
    'ABCDEF0123456789ABCDEF0123456789',
    'https://%',
  ])('rejects %j', (value) => {
    expect(parseCertificateInput(value)).toBeNull();
  });

  it('isCertificateId is strict', () => {
    expect(isCertificateId(NEW_ID)).toBe(true);
    expect(isCertificateId(` ${NEW_ID}`)).toBe(false);
  });
});
