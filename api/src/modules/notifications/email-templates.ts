import {
  DEFAULT_EMAIL_LANGUAGE,
  type Certificate,
  type EmailLanguage,
} from '../../shared/domain.js';
import type { ComposedContent, MessageComposer, MessageLinks } from './message-composer.js';

/**
 * Localised certificate e-mail (BEU-ICT/certificate-manager#376). No template engine: values pass
 * through the `markup` tagged template, which escapes every interpolation unless it is a
 * {@link SafeHtml} produced by the same function.
 */

class SafeHtml {
  constructor(readonly value: string) {}
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Tagged template: interpolated strings are escaped, nested `markup` results are kept. */
export function markup(strings: TemplateStringsArray, ...values: (string | SafeHtml)[]): SafeHtml {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += (value instanceof SafeHtml ? value.value : escapeHtml(value)) + (strings[i + 1] ?? '');
  });
  return new SafeHtml(out);
}

/** Header-bound and display values: CR/LF (and other control characters) become single spaces. */
export function oneLine(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export const SUBJECT_NAME_MAX = 120;

/** Truncates to `max` characters (code points) including the ellipsis. */
export function truncate(value: string, max = SUBJECT_NAME_MAX): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`;
}

interface Strings {
  subject: (eventName: string) => string;
  greeting: (ownerName: string) => string;
  issued: (organizationName: string, eventName: string) => string;
  button: string;
  linkIntro: string;
  reason: string;
  contact: (email: string) => string;
}

// Azerbaijani wording: needs native-speaker review (listed in the PR notes).
const STRINGS: Record<EmailLanguage, Strings> = {
  en: {
    subject: (e) => `Your certificate: ${e}`,
    greeting: (o) => `Hello ${o},`,
    issued: (org, e) => `A certificate was issued to you by ${org} for ${e}.`,
    button: 'View your certificate',
    linkIntro: 'You can view your certificate at this link:',
    reason:
      'You received this email because this address was provided when the certificate was issued.',
    contact: (email) => `If you have questions, reply to this email or write to ${email}.`,
  },
  az: {
    subject: (e) => `Sertifikatınız: ${e}`,
    greeting: (o) => `Salam, ${o}!`,
    issued: (org, e) => `${org} tərəfindən sizə ${e} üçün sertifikat verilmişdir.`,
    button: 'Sertifikata bax',
    linkIntro: 'Sertifikatınıza bu keçiddən baxa bilərsiniz:',
    reason: 'Bu məktubu sertifikat verilərkən bu e-poçt ünvanı göstərildiyi üçün alırsınız.',
    contact: (email) =>
      `Suallarınız varsa, bu məktubu cavablandırın və ya ${email} ünvanına yazın.`,
  },
};

export interface TemplateInput {
  language: EmailLanguage;
  ownerName: string;
  organizationName: string;
  eventName: string;
  verifyUrl: string;
  contactEmail: string;
}

export function renderCertificateEmail(input: TemplateInput): ComposedContent {
  const s = STRINGS[input.language] ?? STRINGS[DEFAULT_EMAIL_LANGUAGE];
  const owner = oneLine(input.ownerName);
  const org = oneLine(input.organizationName);
  const event = oneLine(input.eventName);
  const url = oneLine(input.verifyUrl);
  const contact = oneLine(input.contactEmail);

  const subject = s.subject(truncate(event));
  const text = [
    s.greeting(owner),
    '',
    s.issued(org, event),
    '',
    s.linkIntro,
    url,
    '',
    s.reason,
    s.contact(contact),
    '',
  ].join('\n');

  const body = markup`<!DOCTYPE html>
<html lang="${input.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:24px 12px;">
<main style="max-width:560px;background:#ffffff;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;text-align:left;">
<p style="margin:0 0 16px;">${s.greeting(owner)}</p>
<p style="margin:0 0 24px;">${s.issued(org, event)}</p>
<p style="margin:0 0 24px;"><a href="${url}" style="display:inline-block;background:#0b4fc2;color:#ffffff;text-decoration:underline;padding:12px 24px;border-radius:4px;font-weight:bold;">${s.button}</a></p>
<p style="margin:0 0 24px;font-size:14px;">${s.linkIntro}<br><a href="${url}" style="color:#0b4fc2;word-break:break-all;">${url}</a></p>
<hr style="border:0;border-top:1px solid #d4d4d8;margin:0 0 16px;">
<p style="margin:0 0 8px;font-size:14px;color:#52525b;">${s.reason}</p>
<p style="margin:0;font-size:14px;color:#52525b;">${s.contact(contact)}</p>
</main>
</td></tr>
</table>
</body>
</html>
`;
  return { subject, text, html: body.value };
}

/** Real {@link MessageComposer}: language from the links (default `az`). */
export class TemplateMessageComposer implements MessageComposer {
  constructor(private readonly fallbackContact: string) {}

  compose(certificate: Certificate, links: MessageLinks): ComposedContent {
    return renderCertificateEmail({
      language: links.language ?? DEFAULT_EMAIL_LANGUAGE,
      ownerName: certificate.ownerName,
      organizationName: certificate.organizationName,
      eventName: certificate.eventName,
      verifyUrl: links.verifyUrl,
      contactEmail: links.contactEmail ?? this.fallbackContact,
    });
  }
}
