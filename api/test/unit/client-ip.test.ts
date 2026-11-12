import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { getClientIp, resolveClientIp, TRUSTED_PROXY_HOPS } from '../../src/http/client-ip.js';

const r = (forwardedFor: string | undefined, trustedHops = 1, socketAddress = '10.0.0.1') =>
  resolveClientIp({ forwardedFor, socketAddress, trustedHops });

describe('resolveClientIp', () => {
  it('uses the rightmost entry for one hop (IPv4)', () => {
    expect(r('203.0.113.7')).toBe('203.0.113.7');
    expect(r('1.1.1.1, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('uses the second entry from the right for two hops', () => {
    expect(r('9.9.9.9, 203.0.113.7, 130.211.0.1', 2)).toBe('203.0.113.7');
  });

  it('ignores 50 random forged leading entries', () => {
    for (let i = 0; i < 50; i++) {
      const forged = `${randomInt(11, 99)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
      expect(r(`${forged}, 203.0.113.7`)).toBe('203.0.113.7');
      expect(r(`${forged}, 198.51.100.9, 130.211.0.1`, 2)).toBe('198.51.100.9');
    }
  });

  it('normalises IPv6 to its /64 prefix', () => {
    expect(r('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(r('2001:DB8:1:2:ffff::1')).toBe('2001:db8:1:2::/64');
    expect(r('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(r('2001:db8:0:0:0:0:0:1')).toBe('2001:db8:0:0::/64');
    expect(r('2001:db8::1%eth0')).toBe('2001:db8:0:0::/64');
    expect(r('2001:db8:5::')).toBe('2001:db8:5:0::/64');
  });

  it('maps IPv4-mapped IPv6 to the IPv4 address', () => {
    expect(r('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(r('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(r('::ffff:10.1.1.1', 1, '192.0.2.5')).toBe('192.0.2.5');
  });

  it('strips ports', () => {
    expect(r('203.0.113.7:5678')).toBe('203.0.113.7');
    expect(r('[2001:db8::1]:443')).toBe('2001:db8:0:0::/64');
    expect(r('[2001:db8::1]')).toBe('2001:db8:0:0::/64');
  });

  it.each([
    'garbage',
    '',
    '   ',
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    '01.2.3.4',
    '1.2.3.04',
    '0x7f.0.0.1',
    '1.2.3.4:abc',
    '[2001:db8::1',
    '[2001:db8::1]x',
    '2001:db8:::1',
    '1:2:3:4:5:6:7:8:9',
    '1.2.3.4, ',
  ])('treats %j as malformed and falls back to the socket', (value) => {
    expect(r(value, 1, '192.0.2.5')).toBe('192.0.2.5');
  });

  it.each([
    '127.0.0.1',
    '10.2.3.4',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
  ])('ignores non-public %s', (value) => {
    expect(r(`${value}`, 1, '192.0.2.5')).toBe('192.0.2.5');
  });

  it('accepts public addresses adjacent to private ranges', () => {
    expect(r('172.32.0.1')).toBe('172.32.0.1');
    expect(r('100.128.0.1')).toBe('100.128.0.1');
  });

  it('handles a missing header and too few entries', () => {
    expect(r(undefined, 1, '192.0.2.5')).toBe('192.0.2.5');
    expect(r('203.0.113.7', 2, '192.0.2.5')).toBe('192.0.2.5');
  });

  it('joins repeated header lines', () => {
    expect(
      resolveClientIp({
        forwardedFor: ['1.1.1.1', '203.0.113.7'],
        socketAddress: '10.0.0.1',
        trustedHops: 1,
      }),
    ).toBe('203.0.113.7');
  });

  it('falls back to a private socket address and never throws', () => {
    expect(r(undefined, 1, '127.0.0.1')).toBe('127.0.0.1');
    expect(r(undefined, 1, '::1')).toBe('0:0:0:0::/64');
    expect(r(undefined, 1, '::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(resolveClientIp({ trustedHops: 1 })).toBe('unknown');
    expect(r(undefined, 1, 'nonsense')).toBe('unknown');
    expect(r('203.0.113.7', 0)).toBe('10.0.0.1');
    expect(r('203.0.113.7', Number.NaN)).toBe('10.0.0.1');
    expect(r('203.0.113.7', -1)).toBe('10.0.0.1');
  });
});

describe('getClientIp', () => {
  it('reads the header and socket of a request', () => {
    expect(
      getClientIp({
        headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.7' },
        socket: { remoteAddress: '10.0.0.1' },
      }),
    ).toBe('203.0.113.7');
    expect(getClientIp({ headers: {}, socket: {} })).toBe('unknown');
  });

  it('ignores Fastly-Client-IP and X-Real-IP', () => {
    expect(
      getClientIp({
        headers: { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '8.8.8.8' },
        socket: { remoteAddress: '10.0.0.1' },
      }),
    ).toBe('203.0.113.7');
  });

  it('agrees with Fastify request.ip for the default hop count', async () => {
    const app = buildApp();
    app.get('/__ip', (request) => ({ ip: request.ip, key: getClientIp(request) }));
    await app.ready();
    expect(TRUSTED_PROXY_HOPS).toBe(1);
    const cases: [string | undefined, string][] = [
      ['6.6.6.6, 203.0.113.7', '203.0.113.7'],
      ['203.0.113.7', '203.0.113.7'],
      [undefined, '192.0.2.50'],
    ];
    for (const [xff, expected] of cases) {
      const res = await app.inject({
        method: 'GET',
        url: '/__ip',
        remoteAddress: '192.0.2.50',
        headers: xff ? { 'x-forwarded-for': xff } : {},
      });
      const body = res.json<{ ip: string; key: string }>();
      expect(body.ip).toBe(expected);
      expect(body.key).toBe(body.ip);
    }
    await app.close();
  });
});
