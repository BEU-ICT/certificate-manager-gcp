import { describe, expect, it, vi } from 'vitest';
import { BREVO_SEND_URL, BrevoEmailSender } from '../../src/adapters/brevo/brevo-email-sender.js';
import {
  ConfigurationError,
  PermanentEmailError,
  QuotaExceededError,
  TransientEmailError,
  type EmailMessage,
} from '../../src/ports/index.js';

const KEY = ['test', 'brevo', 'key'].join('-');
const message: EmailMessage = {
  to: 'ada@example.org',
  toName: 'Ada Lovelace',
  from: 'certs@example.com',
  replyTo: 'help@example.com',
  subject: 'Your certificate',
  text: 'plain',
  html: '<p>html</p>',
  messageId: '<cm-abc-0@example.com>',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function sender(fetchImpl: typeof fetch) {
  return new BrevoEmailSender({ apiKey: KEY, fromName: 'Certificate Manager', fetch: fetchImpl });
}

async function failure(fetchImpl: typeof fetch): Promise<Error> {
  try {
    await sender(fetchImpl).send(message);
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected send to fail');
}

describe('BrevoEmailSender', () => {
  it('posts the mapped message and returns the Brevo messageId', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(201, { messageId: '<abc@smtp-relay>' })));
    const result = await sender(fetchMock).send(message);
    expect(result).toEqual({ providerMessageId: '<abc@smtp-relay>' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BREVO_SEND_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'api-key': KEY, 'content-type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { email: 'certs@example.com', name: 'Certificate Manager' },
      to: [{ email: 'ada@example.org', name: 'Ada Lovelace' }],
      replyTo: { email: 'help@example.com' },
      subject: 'Your certificate',
      textContent: 'plain',
      htmlContent: '<p>html</p>',
      headers: { 'Message-ID': '<cm-abc-0@example.com>', 'Auto-Submitted': 'auto-generated' },
    });
  });

  it('omits optional fields', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(201, { messageId: 'm' })));
    const bare: EmailMessage = { ...message };
    delete bare.toName;
    delete bare.replyTo;
    await new BrevoEmailSender({ apiKey: KEY, fetch: fetchMock }).send(bare);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['replyTo']).toBeUndefined();
    expect(body['to']).toEqual([{ email: 'ada@example.org' }]);
    expect(body['sender']).toEqual({ email: 'certs@example.com' });
  });

  it('maps 400 with an invalid-address code to PermanentEmailError carrying only the code', async () => {
    const error = await failure(() =>
      Promise.resolve(
        json(400, { code: 'invalid_parameter', message: 'valid to email address required' }),
      ),
    );
    expect(error).toBeInstanceOf(PermanentEmailError);
    expect(error.message).toBe('INVALID_PARAMETER');
  });

  it.each([
    { code: 'missing_parameter', message: 'to is required' },
    { code: 'invalid_parameter', message: 'sender is not valid' },
    { code: 'invalid_parameter', message: 'payload too large' },
    { code: 'unknown' },
  ])('maps a non-address 400 %j to ConfigurationError', async (body) => {
    const error = await failure(() => Promise.resolve(json(400, body)));
    expect(error).toBeInstanceOf(ConfigurationError);
  });

  it('maps an unparseable 400 body to ConfigurationError', async () => {
    const error = await failure(() => Promise.resolve(new Response('nope', { status: 400 })));
    expect(error).toBeInstanceOf(ConfigurationError);
  });

  it.each([401, 403])('maps %i to ConfigurationError', async (status) => {
    const error = await failure(() => Promise.resolve(json(status, { code: 'unauthorized' })));
    expect(error).toBeInstanceOf(ConfigurationError);
  });

  it('maps 429 to QuotaExceededError', async () => {
    const error = await failure(() => Promise.resolve(json(429, { code: 'too_many_requests' })));
    expect(error).toBeInstanceOf(QuotaExceededError);
  });

  it.each([500, 502, 503, 404])('maps %i to TransientEmailError', async (status) => {
    const error = await failure(() => Promise.resolve(json(status, {})));
    expect(error).toBeInstanceOf(TransientEmailError);
  });

  it('maps a missing messageId on success to TransientEmailError', async () => {
    const error = await failure(() => Promise.resolve(json(201, {})));
    expect(error).toBeInstanceOf(TransientEmailError);
  });

  it('maps timeouts and network failures to TransientEmailError', async () => {
    const timeout = await failure(() =>
      Promise.reject(new DOMException('The operation timed out', 'TimeoutError')),
    );
    expect(timeout).toBeInstanceOf(TransientEmailError);
    const network = await failure(() =>
      Promise.reject(new TypeError(`fetch failed for ${message.to} key ${KEY}`)),
    );
    expect(network).toBeInstanceOf(TransientEmailError);
  });

  it('times out for real after timeoutMs', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const error = await new BrevoEmailSender({ apiKey: KEY, fetch: hang, timeoutMs: 20 })
      .send(message)
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(TransientEmailError);
  });

  it('never leaks the key or the address in error messages', async () => {
    const cases: (() => Promise<Response>)[] = [
      () =>
        Promise.resolve(json(400, { code: 'invalid_parameter', message: `${message.to} ${KEY}` })),
      () => Promise.resolve(json(401, { message: KEY })),
      () => Promise.resolve(json(429, { message: message.to })),
      () => Promise.resolve(json(500, { message: `${message.to} ${KEY}` })),
      () => Promise.reject(new Error(`${message.to} ${KEY}`)),
    ];
    for (const c of cases) {
      const error = await failure(c);
      expect(error.message).not.toContain(KEY);
      expect(error.message).not.toContain('example.org');
    }
  });
});
