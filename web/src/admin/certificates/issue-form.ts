import type { TFunction } from 'i18next';
import { z } from 'zod';
import { CERTIFICATE_TYPES } from '@/lib/certificateTypes';
import {
  codePointLength,
  EMAIL_MAX,
  normalizeEmail,
  normalizeText,
  OWNER_NAME_MAX,
  SKILL_MAX,
  SKILLS_MAX_ITEMS,
  SUBJECT_MAX,
} from '@/lib/certificateContent';
import type { IssueCertificateBody } from './issue-api';

export interface IssueFormValues {
  organizationId: string;
  eventId: string;
  type: string;
  /** Empty means "latest version"; the request then omits `templateId`. */
  templateId: string;
  ownerName: string;
  email: string;
  subject: string;
  skills: string[];
  /** `YYYY-MM-DD` as the date input yields it. */
  issuedDate: string;
}

/** Calendar day of `date` in the browser's time zone, `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function defaultValues(): IssueFormValues {
  return {
    organizationId: '',
    eventId: '',
    type: '',
    templateId: '',
    ownerName: '',
    email: '',
    subject: '',
    skills: [],
    issuedDate: localDay(),
  };
}

function textField(max: number, required: string, tooLong: string) {
  return z.string().superRefine((value, ctx) => {
    const length = codePointLength(normalizeText(value));
    if (length < 1) ctx.addIssue({ code: 'custom', message: required });
    else if (length > max) ctx.addIssue({ code: 'custom', message: tooLong });
  });
}

/** Client-side mirror of the server rules; messages are translated by `t`. */
export function issueSchema(t: TFunction) {
  const m = {
    organizationRequired: t('admin:certificates.issueForm.errors.organizationRequired'),
    eventRequired: t('admin:certificates.issueForm.errors.eventRequired'),
    typeRequired: t('admin:certificates.issueForm.errors.typeRequired'),
    ownerRequired: t('admin:certificates.issueForm.errors.ownerRequired'),
    ownerTooLong: t('admin:certificates.issueForm.errors.ownerTooLong', { max: OWNER_NAME_MAX }),
    emailInvalid: t('admin:certificates.issueForm.errors.emailInvalid'),
    subjectRequired: t('admin:certificates.issueForm.errors.subjectRequired'),
    subjectTooLong: t('admin:certificates.issueForm.errors.subjectTooLong', { max: SUBJECT_MAX }),
    skillTooLong: t('admin:certificates.issueForm.errors.skillTooLong', { max: SKILL_MAX }),
    tooManySkills: t('admin:certificates.issueForm.errors.tooManySkills', {
      max: SKILLS_MAX_ITEMS,
    }),
    dateRequired: t('admin:certificates.issueForm.errors.dateRequired'),
    dateFuture: t('admin:certificates.issueForm.errors.dateFuture'),
  };
  return z.object({
    organizationId: z.string().min(1, m.organizationRequired),
    eventId: z.string().min(1, m.eventRequired),
    type: z
      .string()
      .refine((v) => (CERTIFICATE_TYPES as readonly string[]).includes(v), m.typeRequired),
    templateId: z.string(),
    ownerName: textField(OWNER_NAME_MAX, m.ownerRequired, m.ownerTooLong),
    email: z.string().superRefine((value, ctx) => {
      const email = normalizeEmail(value);
      if (email === '') return;
      if (email.length > EMAIL_MAX || !z.email().safeParse(email).success) {
        ctx.addIssue({ code: 'custom', message: m.emailInvalid });
      }
    }),
    subject: textField(SUBJECT_MAX, m.subjectRequired, m.subjectTooLong),
    skills: z
      .array(z.string().refine((s) => codePointLength(s) <= SKILL_MAX, m.skillTooLong))
      .max(SKILLS_MAX_ITEMS, m.tooManySkills),
    issuedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, m.dateRequired)
      .refine((d) => d <= localDay(), m.dateFuture),
  });
}

/**
 * The request body. A date other than today is sent as noon UTC of that day (the API shows the
 * UTC calendar day); today is sent as the current instant, because a later time of day would lie
 * in the future.
 */
export function toRequestBody(
  values: IssueFormValues,
  now: Date = new Date(),
): IssueCertificateBody {
  const email = normalizeEmail(values.email);
  const skills = values.skills;
  return {
    organizationId: values.organizationId,
    eventId: values.eventId,
    type: values.type as IssueCertificateBody['type'],
    ...(values.templateId !== '' ? { templateId: values.templateId } : {}),
    ownerName: normalizeText(values.ownerName),
    ...(email !== '' ? { email } : {}),
    subject: normalizeText(values.subject),
    ...(skills.length > 0 ? { skills } : {}),
    issuedAt:
      values.issuedDate === localDay(now)
        ? now.toISOString()
        : `${values.issuedDate}T12:00:00.000Z`,
  };
}

/** Stable text of the user-entered values: equal text means "the same attempt" for the idempotency key. */
export function attemptSignature(values: IssueFormValues): string {
  return JSON.stringify({
    ...values,
    ownerName: normalizeText(values.ownerName),
    subject: normalizeText(values.subject),
    email: normalizeEmail(values.email),
  });
}
