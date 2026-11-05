import type { TFunction } from 'i18next';
import { z } from 'zod';
import type { EmailLanguage } from './api';

export const NAME_MAX_LENGTH = 120;
export const EMAIL_LANGUAGES: readonly EmailLanguage[] = ['az', 'en'];
/** Endonyms, intentionally not translated. */
export const EMAIL_LANGUAGE_LABEL: Record<EmailLanguage, string> = {
  az: 'Azərbaycan dili',
  en: 'English',
};
export const emailLanguageOptions = EMAIL_LANGUAGES.map((l) => ({
  value: l,
  label: EMAIL_LANGUAGE_LABEL[l],
}));

export function nameSchema(t: TFunction) {
  return z
    .string()
    .trim()
    .min(1, t('admin:events.errors.nameRequired'))
    .max(NAME_MAX_LENGTH, t('admin:events.errors.nameTooLong', { max: NAME_MAX_LENGTH }));
}
