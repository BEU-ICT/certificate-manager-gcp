import { describe, expect, it } from 'vitest';
import { ERROR_CODES, errorMessage, errorMessageKey } from '@/i18n/errors';
import az from '@/locales/az/errors.json';
import en from '@/locales/en/errors.json';
import i18n from '@/i18n';

describe('error mapping', () => {
  it('maps known codes to themselves and unknown ones to GENERIC', () => {
    expect(errorMessageKey('TEXT_DOES_NOT_FIT')).toBe('TEXT_DOES_NOT_FIT');
    expect(errorMessageKey('SOMETHING_NEW')).toBe('GENERIC');
    expect(errorMessageKey(undefined)).toBe('GENERIC');
  });
  it('has a message for every code and GENERIC in both languages', () => {
    for (const code of [...ERROR_CODES, 'GENERIC']) {
      expect(az).toHaveProperty(code);
      expect(en).toHaveProperty(code);
    }
  });
  it('localizes through the errors namespace with a generic fallback', async () => {
    await i18n.changeLanguage('en');
    expect(errorMessage(i18n.t, 'TEMPLATE_MISMATCH')).toBe(en.TEMPLATE_MISMATCH);
    expect(errorMessage(i18n.t, 'UNKNOWN_CODE')).toBe(en.GENERIC);
    await i18n.changeLanguage('az');
    expect(errorMessage(i18n.t, 'NETWORK')).toBe(az.NETWORK);
  });
});
