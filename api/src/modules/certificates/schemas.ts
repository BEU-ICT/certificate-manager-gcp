import { z } from 'zod';
import { CERTIFICATE_TYPES } from '../../shared/certificate-types.js';

/**
 * Field schemas shared by single and bulk issuance (limits: BEU-ICT/certificate-manager#236 section 5). Text fields are
 * normalised (NFC, invisible and bidi characters removed, control characters turned into
 * spaces, whitespace collapsed and trimmed) before the length check, so the limits apply to
 * what is stored and rendered. Lengths are counted in code points.
 */
export const OWNER_NAME_MAX = 120;
export const SUBJECT_MAX = 200;
export const SKILLS_MAX_ITEMS = 10;
export const SKILL_MAX = 40;
export const EMAIL_MAX = 254;
/** `issuedAt` may be at most this far in the future (clock skew); the past is unrestricted. */
export const ISSUED_AT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/** Guard so hostile payloads are not normalised at length; far above any valid field. */
const RAW_TEXT_MAX = 2_000;
const RAW_SKILLS_MAX = 100;

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
    .max(RAW_TEXT_MAX)
    .transform(normalizeText)
    .refine((v) => codePoints(v) >= 1 && codePoints(v) <= max, {
      message: `Must be 1 to ${String(max)} characters`,
    });
}

export const ownerNameSchema = text(OWNER_NAME_MAX);
export const subjectSchema = text(SUBJECT_MAX);

/** Trimmed and lowercased, then validated (max 254, zod `email()`). */
export const emailSchema = z
  .string()
  .max(RAW_TEXT_MAX)
  .transform((v) => v.normalize('NFC').replace(INVISIBLE, '').trim().toLowerCase())
  .pipe(z.string().max(EMAIL_MAX).pipe(z.email()));

/** Absent or blank means "no e-mail"; yields `undefined`. */
export const optionalEmailSchema = z
  .string()
  .max(RAW_TEXT_MAX)
  .optional()
  .transform((v) => (v === undefined || normalizeText(v) === '' ? undefined : v))
  .pipe(emailSchema.optional());

const skillSchema = text(SKILL_MAX);

/** Normalised items, deduplicated case-insensitively keeping the first spelling, then at most 10. */
export const skillsSchema = z
  .array(z.string().max(RAW_TEXT_MAX))
  .max(RAW_SKILLS_MAX)
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
  .refine((v) => v.length <= SKILLS_MAX_ITEMS, {
    message: `At most ${String(SKILLS_MAX_ITEMS)} skills`,
  });

export const certificateTypeSchema = z.enum(CERTIFICATE_TYPES);

/**
 * ISO-8601 string (or Date), not more than five minutes in the future of `now()`, any time in
 * the past. Yields a `Date`.
 */
export function issuedAtSchema(now: () => Date = () => new Date()) {
  return z
    .union([z.iso.datetime({ offset: true }).transform((v) => new Date(v)), z.date()])
    .refine((d) => !Number.isNaN(d.getTime()), { message: 'Invalid date' })
    .refine((d) => d.getTime() <= now().getTime() + ISSUED_AT_FUTURE_TOLERANCE_MS, {
      message: 'Must not be more than 5 minutes in the future',
    });
}

/**
 * Shape of the certificate content fields; spread into a `z.strictObject` of the single or
 * the bulk request so both use identical rules.
 */
export function certificateContentShape(now: () => Date = () => new Date()) {
  return {
    ownerName: ownerNameSchema,
    email: optionalEmailSchema,
    subject: subjectSchema,
    skills: skillsSchema.default([]),
    issuedAt: issuedAtSchema(now),
    type: certificateTypeSchema,
  };
}

/**
 * One element of a bulk request (`items[]`), validated and normalised exactly like a single
 * issuance. Strict: unknown properties are rejected. `subject` is optional here because the
 * request-level subject is the default; the service reports an item without any subject.
 */
export function bulkItemSchema(now: () => Date = () => new Date()) {
  const content = certificateContentShape(now);
  return z.strictObject({
    ownerName: content.ownerName,
    email: content.email,
    subject: content.subject.optional(),
    skills: content.skills,
    issuedAt: content.issuedAt.optional(),
  });
}
