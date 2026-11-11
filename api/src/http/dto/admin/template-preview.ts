import { z } from 'zod';
import {
  OWNER_NAME_MAX,
  SKILLS_MAX_ITEMS,
  SKILL_MAX,
  SUBJECT_MAX,
  issuedAtSchema,
  ownerNameSchema,
  skillsSchema,
  subjectSchema,
} from '../../../modules/certificates/index.js';
import type { RenderInput } from '../../../modules/pdf/index.js';
import type { CertificateType } from '../../../shared/certificate-types.js';

/** The preview QR code encodes this ID: 22 characters like a real one, but it never resolves. */
export const PREVIEW_CERTIFICATE_ID = 'PREVIEW000000000000000';

export const PREVIEW_PRESETS = ['typical', 'longest'] as const;

/**
 * Same limits and normalisation as real certificates; unknown properties are rejected. One
 * module-level instance, because the OpenAPI schema ID may be registered only once.
 */
export const TemplatePreviewBodyDto = z
  .strictObject({
    ownerName: ownerNameSchema.optional(),
    subject: subjectSchema.optional(),
    skills: skillsSchema.optional(),
    issuedAt: issuedAtSchema().optional(),
    preset: z
      .enum(PREVIEW_PRESETS)
      .optional()
      .describe(
        '`typical` (default) or `longest`: every field at its maximum length, to stress the layout.',
      ),
  })
  .meta({
    id: 'TemplatePreviewBody',
    description:
      'All properties are optional; the body itself may be omitted. Provided fields override the preset.',
  });

export type TemplatePreviewBody = z.infer<typeof TemplatePreviewBodyDto>;

/** Pads `unit` repeats to exactly `length` characters, never ending in a space. */
function fill(length: number, unit: string): string {
  const text = unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  return text.endsWith(' ') ? `${text.slice(0, -1)}x` : text;
}

const TYPICAL = {
  ownerName: 'Əhməd Məmmədov-Həsənzadə',
  subject: 'Event participation',
  skills: ['Teamwork', 'Public speaking'],
};

/** Values at the maximum field limits (BEU-ICT/certificate-manager#236 section 5). */
function longest(): { ownerName: string; subject: string; skills: string[] } {
  return {
    ownerName: fill(OWNER_NAME_MAX, 'Məmmədov-Həsənzadə Əhməd '),
    subject: fill(SUBJECT_MAX, 'Participation in the annual conference '),
    skills: Array.from({ length: SKILLS_MAX_ITEMS }, (_, i) =>
      fill(SKILL_MAX, `Skill ${String(i + 1).padStart(2, '0')} public speaking `),
    ),
  };
}

/** Preset values overridden by the provided fields; contains no data of real certificates. */
export function buildPreviewInput(
  body: TemplatePreviewBody,
  type: CertificateType,
  now: Date,
  publicBaseUrl: string,
): RenderInput {
  const preset = body.preset === 'longest' ? longest() : TYPICAL;
  return {
    ownerName: body.ownerName ?? preset.ownerName,
    subject: body.subject ?? preset.subject,
    skills: [...(body.skills ?? preset.skills)],
    issuedAt: body.issuedAt ?? now,
    type,
    publicUrl: `${publicBaseUrl.replace(/\/+$/, '')}/c/${PREVIEW_CERTIFICATE_ID}`,
  };
}
