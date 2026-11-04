export const SUPPORTED_LANGUAGES = ['az', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'az';
export const STORAGE_KEY = 'cm.lang';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export interface ResolveInput {
  /** Value of the persisted explicit choice, or null when absent / storage unavailable. */
  stored: string | null;
  /** `location.search`. */
  search: string;
  /** `navigator.language`. */
  navigatorLanguage: string | undefined;
}

/**
 * Pure resolution order: stored explicit choice, then `?lang=az|en`, then a browser language
 * starting with `en`, then the default (`az`).
 */
export function resolveLanguage({ stored, search, navigatorLanguage }: ResolveInput): Language {
  if (isLanguage(stored)) return stored;
  const query = new URLSearchParams(search).get('lang');
  if (isLanguage(query)) return query;
  if (navigatorLanguage?.toLowerCase().startsWith('en')) return 'en';
  return DEFAULT_LANGUAGE;
}

export function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Storage may be blocked (private mode); the choice then lasts for the session only.
  }
}

export function detectLanguage(): Language {
  return resolveLanguage({
    stored: readStoredLanguage(),
    search: window.location.search,
    navigatorLanguage: window.navigator.language,
  });
}
