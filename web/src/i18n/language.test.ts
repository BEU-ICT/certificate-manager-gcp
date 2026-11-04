import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, persistLanguage, readStoredLanguage, resolveLanguage } from '@/i18n/language';

const base = { stored: null, search: '', navigatorLanguage: undefined };

describe('resolveLanguage', () => {
  it('defaults to az', () => {
    expect(resolveLanguage(base)).toBe('az');
    expect(resolveLanguage({ ...base, navigatorLanguage: 'ru-RU' })).toBe('az');
  });
  it('uses an English browser language', () => {
    expect(resolveLanguage({ ...base, navigatorLanguage: 'en-US' })).toBe('en');
    expect(resolveLanguage({ ...base, navigatorLanguage: 'EN' })).toBe('en');
  });
  it('prefers ?lang over the browser language', () => {
    expect(resolveLanguage({ ...base, search: '?lang=az', navigatorLanguage: 'en-US' })).toBe('az');
    expect(resolveLanguage({ ...base, search: '?x=1&lang=en' })).toBe('en');
  });
  it('ignores unsupported ?lang values', () => {
    expect(resolveLanguage({ ...base, search: '?lang=fr', navigatorLanguage: 'en' })).toBe('en');
  });
  it('prefers the stored choice over everything', () => {
    expect(resolveLanguage({ stored: 'az', search: '?lang=en', navigatorLanguage: 'en-US' })).toBe(
      'az',
    );
  });
  it('ignores an invalid stored value', () => {
    expect(resolveLanguage({ ...base, stored: 'xx', search: '?lang=en' })).toBe('en');
  });
});

describe('storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });
  it('persists and reads the explicit choice', () => {
    persistLanguage('en');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en');
    expect(readStoredLanguage()).toBe('en');
  });
  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredLanguage()).toBeNull();
    expect(() => {
      persistLanguage('en');
    }).not.toThrow();
  });
});
