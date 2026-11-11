import { createHash } from 'node:crypto';
import type { EmailMessage } from '../ports/email-sender.js';

/**
 * Builds RFC 5322 / MIME (RFC 2045-2047) messages for senders that take a raw message (Gmail).
 * Providers with structured fields (Brevo) do not use it. Pure: no I/O, no vendor imports.
 *
 * Output: CRLF line endings, `multipart/alternative` with a `text/plain` and a `text/html` part,
 * both UTF-8 and base64, non-ASCII headers as RFC 2047 encoded-words. Values with CR, LF or NUL are
 * rejected, so caller data can never add headers (header injection). Error messages never quote
 * the offending value (it may be personal data).
 */

export class MessageBuildError extends Error {
  override readonly name = 'MessageBuildError';
}

const CRLF = '\r\n';
const MAX_HEADER_LINE = 76;
/** Pragmatic addr-spec: ASCII local part and domain, no quoting, no comments. */
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const MESSAGE_ID = /^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+>$/;
const FORBIDDEN = /[\r\n\0]/;

export interface BuildOptions {
  /** `Date` header; passed in so the output is deterministic. */
  date: Date;
}

export function buildMessage(message: EmailMessage, options: BuildOptions): string {
  const from = address(message.from, undefined, 'from');
  const to = address(message.to, message.toName, 'to');
  const messageId = normalizeMessageId(message.messageId);
  const boundary = makeBoundary(message);

  const headers: string[] = [`Date: ${rfc5322Date(options.date)}`, `From: ${from}`, `To: ${to}`];
  if (message.replyTo !== undefined)
    headers.push(`Reply-To: ${address(message.replyTo, undefined, 'replyTo')}`);
  headers.push(
    `Subject: ${encodeHeaderText(message.subject, 'subject')}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  );

  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(body),
    ].join(CRLF);

  return (
    headers.join(CRLF) +
    CRLF +
    CRLF +
    [part('text/plain', message.text), part('text/html', message.html), `--${boundary}--`, ''].join(
      CRLF,
    )
  );
}

function assertSafe(value: string, what: string): void {
  if (FORBIDDEN.test(value)) throw new MessageBuildError(`${what} contains a line break or NUL`);
}

function address(addr: string, name: string | undefined, what: string): string {
  assertSafe(addr, what);
  if (!ADDRESS.test(addr) || addr.length > 254)
    throw new MessageBuildError(`${what} is not a valid address`);
  if (name === undefined || name === '') return addr;
  assertSafe(name, `${what} name`);
  return `${displayName(name, what)} <${addr}>`;
}

function displayName(name: string, what: string): string {
  if (/^[\x20-\x7e]*$/.test(name)) {
    return /^[A-Za-z0-9 !#$%&'*+/=?^_`{|}~-]*$/.test(name)
      ? name
      : `"${name.replace(/(["\\])/g, '\\$1')}"`;
  }
  return encodeHeaderText(name, `${what} name`);
}

function normalizeMessageId(id: string): string {
  assertSafe(id, 'messageId');
  const wrapped = id.startsWith('<') ? id : `<${id}>`;
  if (!MESSAGE_ID.test(wrapped) || wrapped.length > 200) {
    throw new MessageBuildError('messageId is not a valid Message-ID');
  }
  return wrapped;
}

/**
 * Plain ASCII passes through; anything else becomes RFC 2047 `=?UTF-8?B?...?=` words of at most
 * 75 characters, split on code-point boundaries and folded with CRLF + space.
 */
function encodeHeaderText(value: string, what: string): string {
  assertSafe(value, what);
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  // Encoded-word budget: 75 chars total, `=?UTF-8?B?` + `?=` use 12, base64 gives 4 chars per 3 bytes.
  const maxBytes = Math.floor((75 - 12) / 4) * 3;
  const words: string[] = [];
  let chunk = '';
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, 'utf8') > maxBytes) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`)
    .join(`${CRLF} `);
}

function base64Lines(body: string): string {
  const encoded = Buffer.from(body, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += MAX_HEADER_LINE)
    lines.push(encoded.slice(i, i + MAX_HEADER_LINE));
  return lines.join(CRLF) + CRLF;
}

/** Deterministic (retries produce identical bytes); base64 bodies can never contain it. */
function makeBoundary(message: EmailMessage): string {
  const digest = createHash('sha256')
    .update(message.messageId)
    .update('\0')
    .update(message.text)
    .update('\0')
    .update(message.html)
    .digest('hex')
    .slice(0, 32);
  return `=_cm_${digest}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rfc5322Date(d: Date): string {
  if (Number.isNaN(d.getTime())) throw new MessageBuildError('date is invalid');
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${DAYS[d.getUTCDay()]}, ${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`
  );
}
