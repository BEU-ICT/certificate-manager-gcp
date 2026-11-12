import { describe, expect, it } from 'vitest';
import {
  TemplateMessageComposer,
  createSendEmailHandler,
  escapeHtml,
  markup,
  renderCertificateEmail,
  truncate,
  type TemplateInput,
} from '../../src/modules/notifications/index.js';
import { buildMessage } from '../../src/shared/message-builder.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import { createFakes } from '../../src/testing/fakes/index.js';

const base: TemplateInput = {
  language: 'en',
  ownerName: 'Jane Doe',
  organizationName: 'Example Org',
  eventName: 'Spring Workshop',
  verifyUrl: 'https://certs.example.org/c/AbCdEf123456',
  contactEmail: 'support@example.org',
};

describe('renderCertificateEmail', () => {
  it('matches the English snapshot', () => {
    const out = renderCertificateEmail(base);
    expect(out.subject).toBe('Your certificate: Spring Workshop');
    expect(out.text).toMatchSnapshot('text');
    expect(out.html).toMatchSnapshot('html');
  });

  it('matches the Azerbaijani snapshot', () => {
    const out = renderCertificateEmail({
      ...base,
      language: 'az',
      ownerName: 'Aygün Məmmədova',
      eventName: 'Şəbəkə təhlükəsizliyi',
    });
    expect(out.subject).toBe('Sertifikatınız: Şəbəkə təhlükəsizliyi');
    expect(out.text).toMatchSnapshot('text');
    expect(out.html).toMatchSnapshot('html');
  });

  it('escapes <script>, quotes and keeps Azerbaijani characters', () => {
    const out = renderCertificateEmail({
      ...base,
      language: 'az',
      ownerName: `<script>alert("x")</script> 'Əli' & Ğ`,
      organizationName: '"><img src=x onerror=1>',
      eventName: 'Çay <b>ıö</b>üşğ',
    });
    expect(out.html).not.toContain('<script');
    expect(out.html).not.toContain('<img');
    expect(out.html).not.toContain('<b>');
    expect(out.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(out.html).toContain('&#39;Əli&#39; &amp; Ğ');
    expect(out.html).toContain('Çay &lt;b&gt;ıö&lt;/b&gt;üşğ');
    // The text part is plain text: not HTML-escaped.
    expect(out.text).toContain('<script>');
  });

  it('escapes the link and contact address', () => {
    const out = renderCertificateEmail({
      ...base,
      verifyUrl: 'https://x.example/c/a"onmouseover="1',
      contactEmail: 'a<b>@example.org',
    });
    expect(out.html).not.toContain('"onmouseover');
    expect(out.html).toContain('a&lt;b&gt;@example.org');
  });

  it('strips CR/LF from subject and names', () => {
    const out = renderCertificateEmail({
      ...base,
      ownerName: 'Eve\r\nBcc: evil@example.org',
      eventName: 'Ev\r\nent\nName\u2028x',
    });
    expect(out.subject).toBe('Your certificate: Ev ent Name x');
    expect(out.subject).not.toMatch(/[\r\n]/);
    expect(out.text.split('\n')[0]).toBe('Hello Eve Bcc: evil@example.org,');
    expect(out.html).not.toContain('\r');
  });

  it('cannot inject headers through the message builder', () => {
    const out = renderCertificateEmail({ ...base, eventName: 'A\r\nBcc: evil@example.org' });
    const raw = buildMessage(
      {
        to: 'to@example.org',
        from: 'from@example.org',
        subject: out.subject,
        text: out.text,
        html: out.html,
        messageId: '<m@example.org>',
      },
      { date: new Date(0) },
    );
    expect(raw.split('\r\n').some((l) => l.startsWith('Bcc:'))).toBe(false);
  });

  it('truncates event names over 120 characters in the subject only', () => {
    const eventName = 'ə'.repeat(150);
    const out = renderCertificateEmail({ ...base, eventName });
    const name = out.subject.replace('Your certificate: ', '');
    expect(Array.from(name)).toHaveLength(120);
    expect(name.endsWith('…')).toBe(true);
    expect(out.text).toContain(eventName);
    expect(out.html).toContain(eventName);
    expect(truncate('x'.repeat(120))).toBe('x'.repeat(120));
    expect(truncate('x'.repeat(121))).toBe(`${'x'.repeat(119)}…`);
  });

  it('links to PUBLIC_BASE_URL/c/<id> only, without query parameters', () => {
    const out = renderCertificateEmail(base);
    const urls = [...out.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(urls).toEqual([base.verifyUrl, base.verifyUrl]);
    expect(out.text.split('\n').filter((l) => l.startsWith('http'))).toEqual([base.verifyUrl]);
    expect(out.html + out.text).not.toMatch(/[?&]utm_|\?/);
  });

  it.each(['az', 'en'] as const)(
    '(%s) is small, semantic, image-free and in parity',
    (language) => {
      const out = renderCertificateEmail({ ...base, language });
      expect(Buffer.byteLength(out.html, 'utf8')).toBeLessThanOrEqual(10 * 1024);
      expect(out.html).toContain(`<html lang="${language}">`);
      expect(out.html).toMatch(/<main[\s>]/);
      expect(out.html).not.toMatch(/<img|<script|<style|<link|url\(/i);
      // Every sentence of the text part appears (escaped) in the HTML part.
      for (const line of out.text.split('\n').filter((l) => l.trim() !== '')) {
        expect(out.html).toContain(escapeHtml(line));
      }
    },
  );

  it('contains the reason line and contact address', () => {
    const en = renderCertificateEmail(base);
    expect(en.text).toContain(
      'You received this email because this address was provided when the certificate was issued.',
    );
    expect(en.text).toContain('support@example.org');
    const az = renderCertificateEmail({ ...base, language: 'az' });
    expect(az.text).toContain('support@example.org');
  });
});

describe('markup tag', () => {
  it('escapes plain interpolations and keeps nested html', () => {
    const inner = markup`<b>${'<i>'}</b>`;
    expect(markup`<p>${inner}${'&'}</p>`.value).toBe('<p><b>&lt;i&gt;</b>&amp;</p>');
  });
});

describe('TemplateMessageComposer', () => {
  it('defaults to az and uses the fallback contact', () => {
    const out = new TemplateMessageComposer('from@example.org').compose(
      sampleCertificate({ eventName: 'Event' }),
      { verifyUrl: 'https://certs.example.org/c/x' },
    );
    expect(out.subject).toBe('Sertifikatınız: Event');
    expect(out.text).toContain('from@example.org');
  });
});

describe('send handler language', () => {
  async function run(emailLanguageOf?: (eventId: string) => Promise<'az' | 'en'>) {
    const fakes = createFakes();
    const cert = sampleCertificate({
      email: 'to@example.org',
      emailStatus: 'pending',
      emailAttempts: 1,
    });
    await fakes.certificates.create(cert);
    const handler = createSendEmailHandler({
      certificates: {
        getPublic: () => Promise.resolve(cert),
        markEmailSent: () => Promise.resolve(),
        markEmailFailed: () => Promise.resolve(),
      },
      emailSender: fakes.emailSender,
      logger: { info: () => undefined, warn: () => undefined, fatal: () => undefined },
      from: { address: 'noreply@example.org', replyTo: 'help@example.org' },
      publicBaseUrl: 'https://certs.example.org/',
      ...(emailLanguageOf && { emailLanguageOf }),
    });
    await handler({ certificateId: cert.id, sequence: 1, retryCount: 0 });
    return { message: fakes.emailSender.sent[0]!, cert };
  }

  it('uses the event language and the Reply-To address', async () => {
    const { message, cert } = await run(() => Promise.resolve('en'));
    expect(message.subject.startsWith('Your certificate: ')).toBe(true);
    expect(message.text).toContain('help@example.org');
    expect(message.text).toContain(`https://certs.example.org/c/${cert.id}`);
  });

  it('defaults to az without a lookup or when it fails', async () => {
    expect((await run()).message.subject.startsWith('Sertifikatınız: ')).toBe(true);
    const failing = await run(() => Promise.reject(new Error('boom')));
    expect(failing.message.subject.startsWith('Sertifikatınız: ')).toBe(true);
  });
});
