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

export interface Certificate {
  id: CertificateId;
  organizationId: OrganizationId;
  eventId: EventId;
  templateRef: TemplateRef;
  type: string;
  status: 'valid' | 'revoked';
  issuedAt: Date;
}
