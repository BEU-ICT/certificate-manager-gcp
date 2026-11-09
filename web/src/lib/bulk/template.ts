import type { Language } from '@/i18n/language';
import type { ColumnId } from './headers';
import { COLUMN_IDS } from './headers';

export type TemplateFormat = 'xlsx' | 'csv';

export const TEMPLATE_FILE_NAMES: Readonly<Record<TemplateFormat, string>> = {
  xlsx: 'certificates-template.xlsx',
  csv: 'certificates-template.csv',
};

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const CSV_MIME = 'text/csv;charset=utf-8';

/** Localized header names; every one of them is accepted back by the parser as an alias. */
export const TEMPLATE_HEADERS: Readonly<Record<Language, Readonly<Record<ColumnId, string>>>> = {
  en: {
    ownerName: 'Full name',
    email: 'Email',
    subject: 'Subject',
    skills: 'Skills',
    issuedAt: 'Date',
  },
  az: {
    ownerName: 'Ad Soyad',
    email: 'E-poçt',
    subject: 'Mövzu',
    skills: 'Bacarıqlar',
    issuedAt: 'Tarix',
  },
};

/** Two example rows; skills are separated by `;` and the date is ISO `YYYY-MM-DD`. */
const EXAMPLES: Readonly<Record<Language, readonly (readonly string[])[]>> = {
  en: [
    [
      'Aysel Məmmədova',
      'aysel@example.com',
      'Introduction to Cloud Computing',
      'Cloud; DevOps',
      '2026-05-14',
    ],
    ['Elchin Hasanov', '', 'Web Security Workshop', 'Security', '2026-05-15'],
  ],
  az: [
    [
      'Aysel Məmmədova',
      'aysel@example.com',
      'Bulud hesablamalarına giriş',
      'Bulud; DevOps',
      '2026-05-14',
    ],
    ['Elçin Həsənov', '', 'Veb təhlükəsizliyi seminarı', 'Təhlükəsizlik', '2026-05-15'],
  ],
};

function rowsFor(language: Language): string[][] {
  const headers = COLUMN_IDS.map((id) => TEMPLATE_HEADERS[language][id]);
  return [headers, ...EXAMPLES[language].map((r) => [...r])];
}

const csvField = (value: string): string =>
  /[",;\r\n\t]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;

/** UTF-8 with BOM (so Excel shows Azerbaijani letters correctly), comma-separated, CRLF. */
export function buildCsvTemplate(language: Language): Blob {
  const text = rowsFor(language)
    .map((row) => row.map(csvField).join(','))
    .join('\r\n');
  return new Blob(['﻿', text, '\r\n'], { type: CSV_MIME });
}

export async function buildXlsxTemplate(language: Language): Promise<Blob> {
  const { buildXlsx } = await import('./xlsxWriter');
  const bytes = buildXlsx(rowsFor(language), 'Certificates');
  return new Blob([bytes.slice().buffer], { type: XLSX_MIME });
}

export async function buildTemplate(format: TemplateFormat, language: Language): Promise<Blob> {
  return format === 'csv' ? buildCsvTemplate(language) : buildXlsxTemplate(language);
}
