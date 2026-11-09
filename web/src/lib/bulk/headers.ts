/** Canonical column ids of the bulk import. */
export const COLUMN_IDS = ['ownerName', 'email', 'subject', 'skills', 'issuedAt'] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];

const ALIASES: Readonly<Record<ColumnId, readonly string[]>> = {
  ownerName: ['ownerName', 'fullName', 'full name', 'name', 'ad soyad', 'ad, soyad'],
  email: ['email', 'e-mail', 'e-poçt'],
  subject: ['subject', 'activity', 'mövzu'],
  skills: ['skills', 'bacarıqlar'],
  issuedAt: ['issuedAt', 'date', 'tarix'],
};

/**
 * Case-insensitive, trimmed key. Azerbaijani letters survive both casings: "I"/"İ"/"ı" all fold
 * to "i" (the dotted capital lowercases to "i" plus a combining dot, which is dropped).
 */
export function headerKey(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu, '')
    .toLowerCase()
    .replace(/\u0307/gu, '')
    .replace(/\u0131/gu, 'i')
    .replace(/\s+/gu, ' ')
    .trim();
}

const LOOKUP = new Map<string, ColumnId>(
  COLUMN_IDS.flatMap((id) => ALIASES[id].map((alias) => [headerKey(alias), id] as const)),
);

/** The column a header cell stands for, or `undefined` for an unknown header. */
export function matchHeader(value: string): ColumnId | undefined {
  return LOOKUP.get(headerKey(value));
}
