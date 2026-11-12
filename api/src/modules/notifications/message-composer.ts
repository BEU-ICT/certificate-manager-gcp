import type { Certificate, EmailLanguage } from '../../shared/domain.js';

export interface ComposedContent {
  subject: string;
  text: string;
  html: string;
}

export interface MessageLinks {
  verifyUrl: string;
  /** Language of the event (`emailLanguage`); default `az` when absent. */
  language?: EmailLanguage | undefined;
  /** Reply-To address shown as the contact; falls back to the composer's default (From address). */
  contactEmail?: string | undefined;
}

/**
 * Builds subject and bodies of the certificate e-mail. A narrow seam; the implementation is
 * `TemplateMessageComposer` (BEU-ICT/certificate-manager#376).
 */
export interface MessageComposer {
  compose(certificate: Certificate, links: MessageLinks): ComposedContent;
}
