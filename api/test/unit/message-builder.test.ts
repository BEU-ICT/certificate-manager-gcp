import { describe, expect, it } from 'vitest';
import { buildMessage, MessageBuildError } from '../../src/shared/message-builder.js';
import type { EmailMessage } from '../../src/ports/index.js';

const base: EmailMessage = {
  to: 'ana@example.com',
  from: 'certificates@example.org',
  subject: 'Your certificate',
  text: 'Hello\nworld',
  html: '<p>Hello</p>',
  messageId: 'cert-abc-1@example.org',
};
const date = new Date('2026-11-04T10:15:30.000Z');
const build = (over: Partial<EmailMessage> = {}) => buildMessage({ ...base, ...over }, { date });

function decodePart(raw: string, type: string): string {
  const start = raw.indexOf(`Content-Type: ${type}; charset=UTF-8`);
  const body = raw.slice(raw.indexOf('\r\n\r\n', start) + 4);
  const b64 = body.slice(0, body.indexOf('--')).replace(/\r\n/g, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('buildMessage', () => {
  it('produces a multipart/alternative message with CRLF only', () => {
    const raw = build();
    expect(raw).toMatch(/^Date: Wed, 04 Nov 2026 10:15:30 \+0000\r\n/);
    expect(raw).toContain('\r\nFrom: certificates@example.org\r\n');
    expect(raw).toContain('\r\nTo: ana@example.com\r\n');
    expect(raw).toContain('\r\nSubject: Your certificate\r\n');
    expect(raw).toContain('\r\nMessage-ID: <cert-abc-1@example.org>\r\n');
    expect(raw).toContain('\r\nMIME-Version: 1.0\r\n');
    expect(raw).toMatch(/\r\nContent-Type: multipart\/alternative; boundary="[^"]+"\r\n\r\n--/);
    expect(raw.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(raw.endsWith('--\r\n')).toBe(true);
    expect(decodePart(raw, 'text/plain')).toBe('Hello\nworld');
    expect(decodePart(raw, 'text/html')).toBe('<p>Hello</p>');
    for (const line of raw.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
  });

  it('is deterministic and keeps an already bracketed Message-ID', () => {
    expect(build()).toBe(build());
    expect(build({ messageId: '<x@y.z>' })).toContain('Message-ID: <x@y.z>');
  });

  it('encodes UTF-8 subjects and names as RFC 2047 words of at most 75 characters', () => {
    const subject = 'Sertifikatınız hazırdır: Təşəkkür edirik! '.repeat(4);
    const raw = build({ subject, toName: 'Əliyev Nərmin' });
    const head = raw.slice(0, raw.indexOf('\r\n\r\n'));
    const unfolded = head.replace(/\r\n /g, ' ');
    const words = unfolded.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/g) ?? [];
    expect(words.length).toBeGreaterThan(2);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    const decoded =
      [...unfolded.matchAll(/Subject: ((?:=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\s?)+)/g)][0]?.[1] ?? '';
    const text = [...decoded.matchAll(/\?B\?([^?]+)\?=/g)]
      .map((m) => Buffer.from(m[1] ?? '', 'base64').toString('utf8'))
      .join('');
    expect(text).toBe(subject);
    expect(head).toMatch(/To: =\?UTF-8\?B\?[^?]+\?= <ana@example.com>/);
    expect(head).toMatch(/^[\x20-\x7e\r\n]*$/);
  });

  it('keeps UTF-8 bodies intact', () => {
    const raw = build({ text: 'Salam, ə ı ö ü ç ş ğ — 🎓', html: '<p>Təşəkkür</p>' });
    expect(decodePart(raw, 'text/plain')).toBe('Salam, ə ı ö ü ç ş ğ — 🎓');
    expect(decodePart(raw, 'text/html')).toBe('<p>Təşəkkür</p>');
  });

  it('quotes ASCII display names that need it and adds Reply-To', () => {
    const raw = build({ toName: 'Doe, "Jane"', replyTo: 'help@example.org' });
    expect(raw).toContain('To: "Doe, \\"Jane\\"" <ana@example.com>');
    expect(raw).toContain('Reply-To: help@example.org');
    expect(build({ toName: 'Jane Doe' })).toContain('To: Jane Doe <ana@example.com>');
  });

  it.each([
    ['subject', { subject: 'Hi\r\nBcc: evil@example.com' }],
    ['subject LF', { subject: 'Hi\nBcc: evil@example.com' }],
    ['to', { to: 'a@example.com\r\nBcc: evil@example.com' }],
    ['toName', { toName: 'Jane\r\nBcc: evil@example.com' }],
    ['from', { from: 'a@example.com\nBcc: x@example.com' }],
    ['replyTo', { replyTo: 'a@example.com\r\nX: y' }],
    ['messageId', { messageId: 'a@b.c>\r\nBcc: x@example.com' }],
    ['NUL', { subject: 'a\0b' }],
  ])('rejects header injection via %s', (_label, over) => {
    expect(() => build(over)).toThrow(MessageBuildError);
  });

  it.each(['not-an-address', 'a b@example.com', '<a@example.com>', 'a@', 'a@b@c.com', ''])(
    'rejects invalid address %j without echoing it',
    (to) => {
      expect(() => build({ to })).toThrow(MessageBuildError);
      try {
        build({ to: `${to}` });
      } catch (err) {
        if (to) expect((err as Error).message).not.toContain(to);
      }
    },
  );

  it('rejects an invalid Message-ID and an invalid date', () => {
    expect(() => build({ messageId: 'no at sign' })).toThrow(MessageBuildError);
    expect(() => buildMessage(base, { date: new Date('nope') })).toThrow(MessageBuildError);
  });

  it('allows line breaks in the body (it is base64 encoded)', () => {
    expect(() => build({ text: 'a\r\nBcc: x', html: '<p>\n</p>' })).not.toThrow();
    expect(build({ text: 'a\r\nBcc: x' })).not.toMatch(/\r\nBcc: x/);
  });
});
