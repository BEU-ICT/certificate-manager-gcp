import {
  FormatterError,
  FormatterRegistry,
  TEMPLATE_TIMEZONE,
  type FormatContext,
} from './formatters.js';

/**
 * Built-in formatters. Names/kinds mirror `KNOWN_FORMATS` (templates module); a unit test asserts
 * the registry covers exactly that set.
 */

/** Casing locale: Azerbaijani rules (dotted/dotless i) for `az`, plain English rules otherwise. */
function casingLocale(ctx: FormatContext): 'az' | 'en' {
  return ctx.locale.toLowerCase().split(/[-_]/)[0] === 'az' ? 'az' : 'en';
}

/**
 * Documented behaviour: with `az`, `i` -> `İ` and `I` -> `ı` (so `istanbul` -> `İSTANBUL` and
 * `ISTANBUL` lowercased -> `ıstanbul`); with `en`, `i` -> `I` and `I` -> `i`.
 */
export function upperCase(value: string, ctx: FormatContext): string {
  return value.toLocaleUpperCase(casingLocale(ctx));
}

export function lowerCase(value: string, ctx: FormatContext): string {
  return value.toLocaleLowerCase(casingLocale(ctx));
}

/** Word starts: beginning of text or after whitespace, hyphen, slash or an opening bracket. */
const WORD_START = /(^|[\s\-/(])(\p{L})/gu;

/** Lowercases everything, then upper-cases each word-initial letter using the locale's rules. */
export function titleCase(value: string, ctx: FormatContext): string {
  const locale = casingLocale(ctx);
  return value
    .toLocaleLowerCase(locale)
    .replace(
      WORD_START,
      (_m, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase(locale),
    );
}

function toDate(value: Date | string): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new FormatterError('Invalid date value');
  return date;
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TEMPLATE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function bakuParts(date: Date): { year: string; month: string; day: string } {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    year: String(parts['year']).padStart(4, '0'),
    month: String(parts['month']),
    day: String(parts['day']),
  };
}

export function dateDmy(value: Date | string): string {
  const { year, month, day } = bakuParts(toDate(value));
  return `${day}.${month}.${year}`;
}

export function dateIso(value: Date | string): string {
  const { year, month, day } = bakuParts(toDate(value));
  return `${year}-${month}-${day}`;
}

const longFormatters = new Map<'az' | 'en', Intl.DateTimeFormat>();

/** `en` uses day-month-year order (`4 November 2026`), matching `az` (`4 noyabr 2026`). */
export function dateLong(value: Date | string, ctx: FormatContext): string {
  const locale = casingLocale(ctx);
  let formatter = longFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale === 'az' ? 'az' : 'en-GB', {
      timeZone: TEMPLATE_TIMEZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    longFormatters.set(locale, formatter);
  }
  return formatter.format(toDate(value));
}

export function listComma(value: readonly string[]): string {
  return value.join(', ');
}

/** Registers the built-in formatters on `registry` and returns it. */
export function registerBuiltinFormatters(registry: FormatterRegistry): FormatterRegistry {
  return registry
    .register('text', (value) => value, { appliesTo: 'text' })
    .register('uppercase', upperCase, { appliesTo: 'text' })
    .register('lowercase', lowerCase, { appliesTo: 'text' })
    .register('titlecase', titleCase, { appliesTo: 'text' })
    .register('date-dmy', dateDmy, { appliesTo: 'date' })
    .register('date-iso', dateIso, { appliesTo: 'date' })
    .register('date-long', dateLong, { appliesTo: 'date' })
    .register('list-comma', listComma, { appliesTo: 'list' });
}

export function createFormatterRegistry(): FormatterRegistry {
  return registerBuiltinFormatters(new FormatterRegistry());
}
