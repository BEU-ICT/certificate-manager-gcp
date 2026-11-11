import type { Language } from '@/i18n/language';

/** File size in B / kB / MB for the active locale. */
export function formatBytes(bytes: number, language: Language): string {
  const nf = (unit: string, value: number) =>
    new Intl.NumberFormat(language, {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(value);
  if (bytes < 1024) return nf('byte', bytes);
  if (bytes < 1024 * 1024) return nf('kilobyte', bytes / 1024);
  return nf('megabyte', bytes / (1024 * 1024));
}
