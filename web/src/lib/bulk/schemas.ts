import { z } from 'zod';

/**
 * Field schemas for one imported row. They mirror `api/src/modules/certificates/schemas.ts`
 * (issue BEU-ICT/certificate-manager#236 section 5): a shared package is out of scope, so keep both files in sync (like
 * `certificateTypes.ts`). Messages are machine codes, the UI translates them.
 */
export const OWNER_NAME_MAX = 120;
export const SUBJECT_MAX = 200;
export const SKILLS_MAX_ITEMS = 10;
export const SKILL_MAX = 40;
export const EMAIL_MAX = 254;
/** `issuedAt` may be at most this far in the future (clock skew); the past is unrestricted. */
export const ISSUED_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const RAW_TEXT_MAX = 2_000;
const RAW_SKILLS_MAX = 100;

export type RowErrorCode = 'required' | 'tooLong' | 'invalid' | 'tooMany' | 'future';

/** Zero-width characters, BOM, soft hyphen, word joiner and bidi embedding/override/isolate marks. */
const INVISIBLE = new RegExp(
  '[\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\ufeff]',
  'gu',
);
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'gu');

export function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(CONTROL, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const codePoints = (value: string): number => Array.from(value).length;

function text(max: number) {
  return z
    .string()
    .max(RAW_TEXT_MAX, { error: 'tooLong' })
    .transform(normalizeText)
    .refine((v) => codePoints(v) >= 1, { error: 'required' })
    .refine((v) => codePoints(v) <= max, { error: 'tooLong' });
}

export const ownerNameSchema = text(OWNER_NAME_MAX);
export const subjectSchema = text(SUBJECT_MAX);

/** Trimmed and lowercased, then validated (max 254, zod `email()`). Blank means "no e-mail". */
export const optionalEmailSchema = z
  .string()
  .max(RAW_TEXT_MAX, { error: 'tooLong' })
  // Same blank test as the server: a value that normalises to '' (whitespace, invisible or
  // control characters only) means "no e-mail".
  .transform((v) =>
    normalizeText(v) === '' ? '' : v.normalize('NFC').replace(INVISIBLE, '').trim().toLowerCase(),
  )
  .pipe(
    z.union([
      z.literal('').transform(() => undefined),
      z
        .string()
        .max(EMAIL_MAX, { error: 'tooLong' })
        .pipe(z.email({ error: 'invalid' })),
    ]),
  );

const skillSchema = text(SKILL_MAX);

/** Normalised items, deduplicated case-insensitively keeping the first spelling, then at most 10. */
export const skillsSchema = z
  .array(z.string().max(RAW_TEXT_MAX, { error: 'tooLong' }))
  .max(RAW_SKILLS_MAX, { error: 'tooMany' })
  .transform((items, ctx) => {
    const seen = new Set<string>();
    const out: string[] = [];
    items.forEach((raw, index) => {
      const parsed = skillSchema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ code: 'custom', message: issue.message, path: [index] });
        }
        return;
      }
      const key = parsed.data.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(parsed.data);
    });
    return out;
  })
  .refine((v) => v.length <= SKILLS_MAX_ITEMS, { error: 'tooMany' });

/** Field limits for messages such as "at most {{max}} characters". */
export const FIELD_LIMITS = {
  ownerName: OWNER_NAME_MAX,
  email: EMAIL_MAX,
  subject: SUBJECT_MAX,
  skills: SKILLS_MAX_ITEMS,
} as const;
