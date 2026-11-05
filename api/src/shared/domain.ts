import type { CertificateType } from './certificate-types.js';
import type { CertificateId, EventId, OrganizationId, TemplateRef } from './ids.js';

/**
 * Persisted entity shapes shared by ports and modules. Only the fields every
 * epic agrees on are listed here; the owning epics extend them.
 * All timestamps are `Date` in memory (ISO strings at the API boundary).
 */
export interface Organization {
  id: OrganizationId;
  slug: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  schemaVersion: number;
}

/** Language of the e-mails sent for an event's certificates. */
export type EmailLanguage = 'az' | 'en';
export const EMAIL_LANGUAGES: readonly EmailLanguage[] = ['az', 'en'];
export const DEFAULT_EMAIL_LANGUAGE: EmailLanguage = 'az';

export interface CertificateEvent {
  id: EventId;
  organizationId: OrganizationId;
  slug: string;
  name: string;
  emailLanguage: EmailLanguage;
  createdAt: Date;
  updatedAt: Date;
  schemaVersion: number;
}

export interface Template {
  ref: TemplateRef;
  organizationId: OrganizationId;
  eventId: EventId;
  type: string;
  version: number;
  createdAt: Date;
}

/** Delivery state of the certificate e-mail (owned by the notifications module). */
export type EmailStatus = 'pending' | 'sent' | 'failed' | 'skipped';
export const EMAIL_STATUSES: readonly EmailStatus[] = ['pending', 'sent', 'failed', 'skipped'];

export type CertificateStatus = 'active' | 'revoked';

export interface Certificate {
  id: CertificateId;
  organizationId: OrganizationId;
  eventId: EventId;
  /** Snapshots taken at issue time; later renames do not change issued certificates. */
  organizationName: string;
  eventName: string;
  /** Template reference (`<slug>-v<n>`) the certificate was rendered from. */
  templateId: TemplateRef;
  type: CertificateType;
  ownerName: string;
  /** Lowercase; absent when the certificate is not e-mailed. */
  email?: string;
  subject: string;
  skills: string[];
  status: CertificateStatus;
  issuedAt: Date;
  revokedAt?: Date;
  revokeReason?: string;
  emailStatus: EmailStatus;
  /** Additive field (#16): delivery attempts so far, default 0. */
  emailAttempts: number;
  emailSentAt?: Date;
  emailLastError?: string;
  /** Object name of the stored PDF; never exposed publicly. */
  pdfPath?: string;
  /** When the PDF was stored. */
  pdfGeneratedAt?: Date;
  /** Additive field (#16): set for certificates imported from the legacy system (#192). */
  legacy?: { id: string; certificateType?: string; template?: string };
  /** Admin user ID that issued the certificate; never exposed publicly. */
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  schemaVersion: number;
}
