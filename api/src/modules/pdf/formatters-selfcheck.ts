import { TEMPLATE_TIMEZONE } from './formatters.js';

/**
 * Startup self-check: the Node runtime must ship full ICU, otherwise Azerbaijani casing and month
 * names silently degrade to English. Throws a descriptive error; call it at boot so the service
 * fails fast instead of rendering wrong text (#102 non-functional requirement).
 */
export function assertFormatterRuntime(): void {
  const problems: string[] = [];

  if (Intl.DateTimeFormat.supportedLocalesOf(['az']).length === 0) {
    problems.push('Intl does not support locale "az"');
  } else {
    const month = new Intl.DateTimeFormat('az', { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 10, 4)),
    );
    if (month !== 'noyabr') problems.push(`Intl "az" month names unavailable (got "${month}")`);
    if (
      'istanbul'.toLocaleUpperCase('az') !== 'İSTANBUL' ||
      'ISTANBUL'.toLocaleLowerCase('az') !== 'ıstanbul'
    ) {
      problems.push('Azerbaijani case mapping (İ/ı) unavailable');
    }
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: TEMPLATE_TIMEZONE });
  } catch {
    problems.push(`Timezone "${TEMPLATE_TIMEZONE}" unavailable`);
  }

  if (problems.length > 0) {
    throw new Error(`Node runtime lacks full ICU support: ${problems.join('; ')}`);
  }
}
