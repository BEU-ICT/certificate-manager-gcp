import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PermanentEmailError, type EmailMessage, type EmailSender } from '../../ports/index.js';

export interface FileEmailSenderOptions {
  /** Output directory (`EMAIL_FILE_DIR`); created on first send. */
  dir: string;
  /** One-line summary sink; receives no addresses or names. */
  log?: (line: string) => void;
  /** Injected for tests. */
  now?: () => Date;
}

const CRLF = '\r\n';
const hasNonAscii = (value: string): boolean => /[^\x20-\x7e]/.test(value);

/** RFC 2047 encoded word for non-ASCII header values. */
function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ');
  return hasNonAscii(clean)
    ? `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
    : clean;
}

function address(email: string, name?: string): string {
  const clean = email.replace(/[\r\n<>]/g, '');
  return name ? `${encodeHeader(name).replace(/"/g, "'")} <${clean}>` : clean;
}

function base64Lines(value: string): string {
  return (
    Buffer.from(value, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g) ?? []
  ).join(CRLF);
}

/** Builds a multipart/alternative RFC 5322 message that mail clients (and text editors) can open. */
export function renderEml(message: EmailMessage, date: Date): string {
  const boundary = `=_cm_${message.messageId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
  const headers = [
    `Message-ID: ${message.messageId}`,
    `Date: ${date.toUTCString()}`,
    `From: ${address(message.from)}`,
    `To: ${address(message.to, message.toName)}`,
    ...(message.replyTo ? [`Reply-To: ${address(message.replyTo)}`] : []),
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    'X-Certificate-Manager-Sink: file',
  ];
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=utf-8`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(body),
    ].join(CRLF);
  return [
    headers.join(CRLF),
    '',
    part('text/plain', message.text),
    part('text/html', message.html),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

/**
 * Local-only sink: writes each message to `<dir>/<timestamp>-<id>.eml` and never touches the network.
 * The port has no attachment field today, so none are written. Re-sending the same Message-ID
 * returns the first file's id and writes nothing (stable Message-ID => no duplicates).
 */
export class FileEmailSender implements EmailSender {
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private readonly written = new Map<string, string>();

  constructor(private readonly options: FileEmailSenderOptions) {
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => undefined);
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const existing = this.written.get(message.messageId);
    if (existing !== undefined) return { providerMessageId: existing };
    const date = this.now();
    const stamp = date.toISOString().replace(/[-:]/g, '').replace('.', '');
    // Local part of the Message-ID only (no domain), e.g. `cm-<certificateId>-<sequence>`.
    const id = (message.messageId.replace(/^<|>$/g, '').split('@')[0] ?? '')
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(0, 80);
    const file = `${stamp}-${id}.eml`;
    try {
      await mkdir(this.options.dir, { recursive: true });
      await writeFile(path.join(this.options.dir, file), renderEml(message, date), { flag: 'wx' });
    } catch {
      // Never include paths or addresses in the message.
      throw new PermanentEmailError('FILE_SINK_WRITE_FAILED');
    }
    this.written.set(message.messageId, `file-${id}`);
    this.log(`file email sink wrote ${file} (subject length ${message.subject.length})`);
    return { providerMessageId: `file-${id}` };
  }
}
