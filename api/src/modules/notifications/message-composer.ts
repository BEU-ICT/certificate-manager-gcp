import type { Certificate } from '../../shared/domain.js';

export interface ComposedContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * Builds subject and bodies of the certificate e-mail. A narrow seam: the localised template of
 * BEU-ICT/certificate-manager#376 replaces {@link PlainMessageComposer} without touching the handler.
 */
export interface MessageComposer {
  compose(certificate: Certificate, links: { verifyUrl: string }): ComposedContent;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Minimal bilingual (az / en) message; every dynamic value is HTML-escaped. */
export class PlainMessageComposer implements MessageComposer {
  compose(certificate: Certificate, links: { verifyUrl: string }): ComposedContent {
    const subject = `${certificate.eventName}: sertifikatınız / your certificate`;
    const lines = [
      `Salam ${certificate.ownerName},`,
      `${certificate.eventName} (${certificate.organizationName}) üçün sertifikatınız hazırdır: ${links.verifyUrl}`,
      '',
      `Hello ${certificate.ownerName},`,
      `Your certificate for ${certificate.eventName} (${certificate.organizationName}) is ready: ${links.verifyUrl}`,
    ];
    const url = escapeHtml(links.verifyUrl);
    const html =
      `<p>Salam ${escapeHtml(certificate.ownerName)},</p>` +
      `<p>${escapeHtml(certificate.eventName)} (${escapeHtml(certificate.organizationName)}) üçün sertifikatınız hazırdır: <a href="${url}">${url}</a></p>` +
      `<p>Hello ${escapeHtml(certificate.ownerName)},</p>` +
      `<p>Your certificate for ${escapeHtml(certificate.eventName)} (${escapeHtml(certificate.organizationName)}) is ready: <a href="${url}">${url}</a></p>`;
    return { subject, text: lines.join('\n'), html };
  }
}
