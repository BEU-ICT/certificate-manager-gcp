/**
 * Field limits and text normalisation of a certificate. This duplicates `schemas.ts` of the
 * certificates module in the API (BEU-ICT/certificate-manager#236 section 5); keep both in sync.
 * The OpenAPI types carry no length limits, so a shared schema cannot be generated from them.
 */
export const OWNER_NAME_MAX = 120;
export const SUBJECT_MAX = 200;
export const SKILLS_MAX_ITEMS = 10;
export const SKILL_MAX = 40;
export const EMAIL_MAX = 254;

/** Zero-width characters, BOM, soft hyphen, word joiner and bidi embedding/override/isolate marks. */
const INVISIBLE = new RegExp(
  '[\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\ufeff]',
  'gu',
);
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'gu');

/** NFC, invisible characters removed, control characters turned into spaces, whitespace collapsed and trimmed. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(CONTROL, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Length in code points, as the server counts. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** Trimmed and lowercased e-mail address as the server stores it. */
export function normalizeEmail(value: string): string {
  return value.normalize('NFC').replace(INVISIBLE, '').trim().toLowerCase();
}
