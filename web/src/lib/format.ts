import type { Language } from '@/i18n/language';

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Date only. `az` renders dd.MM.yyyy (04.11.2026), `en` uses the medium style (Nov 4, 2026).
 * API timestamps are UTC, so the calendar day is taken in UTC unless `timeZone` says otherwise.
 */
export function formatDate(value: DateInput, language: Language, timeZone = 'UTC'): string {
  const options: Intl.DateTimeFormatOptions =
    language === 'az'
      ? { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }
      : { dateStyle: 'medium', timeZone };
  return new Intl.DateTimeFormat(language, options).format(toDate(value));
}

export function formatNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language).format(value);
}
