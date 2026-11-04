import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { localeBackend } from '@/i18n/backend';
import {
  SUPPORTED_LANGUAGES,
  detectLanguage,
  persistLanguage,
  type Language,
} from '@/i18n/language';

export const NAMESPACES = ['common', 'admin', 'public', 'errors'] as const;

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

/**
 * Resolves once the active language's `common` and `errors` namespaces are loaded. Other
 * namespaces (`public`, `admin`) are loaded by the route that calls `useTranslation(ns)`.
 */
export const i18nReady = i18n
  .use(localeBackend)
  .use(initReactI18next)
  .init({
    lng: detectLanguage(),
    // No fallback language: it would download the other language's files. The i18n:check
    // script guarantees both languages define the same keys.
    fallbackLng: false,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    nonExplicitSupportedLngs: false,
    ns: ['common', 'errors'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  });

/** Switches the language without a reload and persists the explicit choice. */
export async function setLanguage(language: Language): Promise<void> {
  persistLanguage(language);
  await i18n.changeLanguage(language);
}

export default i18n;
