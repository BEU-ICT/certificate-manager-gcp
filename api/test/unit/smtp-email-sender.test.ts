import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SmtpEmailSender, mapSmtpError } from '../../src/adapters/smtp/smtp-email-sender.js';
import {
  ConfigurationError,
  PermanentEmailError,
  TransientEmailError,
  type EmailMessage,
} from '../../src/ports/index.js';

const message: EmailMessage = {
  to: 'ada@example.org',
  from: 'certs@example.com',
  subject: 'Your certificate',
  text: 'plain',
  html: '<p>html</p>',
  messageId: '<cm-abc-0@example.com>',
};

/** Minimal scripted SMTP server: `reply` overrides the answer to a command prefix. */
async function fakeServer(reply: Record<string, string> = {}) {
  const received: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    let data = false;
    let buf = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (data) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          received.push(buf.slice(0, end));
          buf = buf.slice(end + 5);
          data = false;
          socket.write(reply['DATA END'] ?? '250 queued\r\n');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.toUpperCase();
        const key = Object.keys(reply).find((k) => cmd.startsWith(k));
        if (key && key !== 'DATA END') socket.write(reply[key] as string);
        else if (cmd.startsWith('EHLO')) socket.write('250-fake\r\n250 8BITMIME\r\n');
        else if (cmd === 'DATA') {
          data = true;
          socket.write('354 go\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    received,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((c) => c()));

async function send(reply: Record<string, string>, tls: 'none' | 'starttls' = 'none') {
  const server = await fakeServer(reply);
  const sender = new SmtpEmailSender({ host: '127.0.0.1', port: server.port, tls });
  closers.push(() => sender.close(), server.close);
  return { server, result: sender.send(message) };
}

describe('SmtpEmailSender', () => {
  it('delivers a multipart/alternative message with the given Message-ID', async () => {
    const { server, result } = await send({});
    await expect(result).resolves.toEqual({ providerMessageId: message.messageId });
    const mail = server.received[0] as string;
    expect(mail).toContain('Message-ID: <cm-abc-0@example.com>');
    expect(mail).toContain('To: ada@example.org');
    expect(mail).toContain('Content-Type: multipart/alternative');
    expect(mail).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mail).toContain('Content-Type: text/html; charset=UTF-8');
  });

  it('maps a 5xx recipient rejection to PermanentEmailError without the address', async () => {
    const { result } = await send({ 'RCPT TO': '550 5.1.1 no such user ada@example.org\r\n' });
    const error = await result.catch((e: Error) => e);
    expect(error).toBeInstanceOf(PermanentEmailError);
    expect((error as Error).message).not.toContain('ada');
  });

  it('maps a 4xx response to TransientEmailError', async () => {
    const { result } = await send({ 'RCPT TO': '451 4.3.0 try later\r\n' });
    await expect(result).rejects.toBeInstanceOf(TransientEmailError);
  });

  it('maps a 4xx after DATA to TransientEmailError and a 5xx to PermanentEmailError', async () => {
    const t = await send({ 'DATA END': '452 4.2.2 mailbox full\r\n' });
    await expect(t.result).rejects.toBeInstanceOf(TransientEmailError);
    const p = await send({ 'DATA END': '554 5.6.0 rejected content\r\n' });
    await expect(p.result).rejects.toBeInstanceOf(PermanentEmailError);
  });

  it('maps a rejected sender to ConfigurationError', async () => {
    const { result } = await send({ 'MAIL FROM': '553 5.7.1 sender not allowed\r\n' });
    await expect(result).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('refuses to send in clear text when STARTTLS is required', async () => {
    const { result } = await send({ STARTTLS: '502 5.5.1 not supported\r\n' }, 'starttls');
    await expect(result).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('maps connection failures to TransientEmailError', async () => {
    const sender = new SmtpEmailSender({ host: '127.0.0.1', port: 1, tls: 'none' });
    closers.push(() => sender.close());
    await expect(sender.send(message)).rejects.toBeInstanceOf(TransientEmailError);
  });

  it('rejects a header-injection attempt as permanent', async () => {
    const sender = new SmtpEmailSender({ host: '127.0.0.1', port: 1, tls: 'none' });
    closers.push(() => sender.close());
    await expect(sender.send({ ...message, subject: 'a\r\nBcc: x@y.z' })).rejects.toBeInstanceOf(
      PermanentEmailError,
    );
  });
});

describe('mapSmtpError', () => {
  it('maps authentication failures to ConfigurationError', () => {
    expect(mapSmtpError({ code: 'EAUTH', responseCode: 535 })).toBeInstanceOf(ConfigurationError);
  });
});
