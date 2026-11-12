import { isIP } from 'node:net';

/**
 * Number of trusted proxy hops in front of the service. Single source for Fastify's `trustProxy`
 * (app.ts) and for `getClientIp`, so `request.ip` and the rate-limit key cannot drift apart.
 * UNVERIFIED against live traffic, see docs/adr/0017-trusted-client-ip.md.
 */
export const TRUSTED_PROXY_HOPS = 1;

export interface ResolveClientIpInput {
  /** Raw `X-Forwarded-For` value (several header lines are joined with a comma). */
  forwardedFor?: string | readonly string[] | undefined;
  /** Address of the TCP peer. */
  socketAddress?: string | undefined;
  /** Number of trusted proxies; the XFF entry this many positions from the right is the client. */
  trustedHops: number;
}

export interface ClientIpRequest {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  socket: { remoteAddress?: string | undefined };
}

type ParsedIp =
  | { readonly version: 4; readonly octets: readonly number[] }
  | { readonly version: 6; readonly groups: readonly number[] };

const UNKNOWN = 'unknown';
const IPV4_PART = /^(?:0|[1-9]\d{0,2})$/;
const PORT = /^\d{1,5}$/;

function parseIpv4(text: string): ParsedIp | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!IPV4_PART.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return { version: 4, octets };
}

function parseIpv6(text: string): ParsedIp | null {
  const withoutZone = text.split('%')[0] ?? '';
  if (isIP(withoutZone) !== 6) return null;
  let address = withoutZone;
  // Embedded dotted IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4 || v4.version !== 4) return null;
    const [a = 0, b = 0, c = 0, d = 0] = v4.octets;
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const hex = halves.length === 1 ? head : [...head, ...Array<string>(missing).fill('0'), ...rest];
  const groups = hex.map((g) => Number.parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) {
    return null;
  }
  return { version: 6, groups };
}

/** Parses a bare address, `a.b.c.d:port`, `[v6]` or `[v6]:port`. Returns null if malformed. */
function parseIp(raw: string): ParsedIp | null {
  const text = raw.trim();
  if (text === '' || text.length > 64) return null;
  let candidate = text;
  if (text.startsWith('[')) {
    const close = text.indexOf(']');
    if (close < 0) return null;
    const after = text.slice(close + 1);
    if (after !== '' && !(after.startsWith(':') && PORT.test(after.slice(1)))) return null;
    candidate = text.slice(1, close);
  } else if (text.includes('.') && text.split(':').length === 2) {
    const [host = '', port = ''] = text.split(':');
    if (!PORT.test(port)) return null;
    candidate = host;
  }
  const parsed = candidate.includes(':') ? parseIpv6(candidate) : parseIpv4(candidate);
  if (parsed?.version === 6) {
    const g = parsed.groups;
    // IPv4-mapped (::ffff:a.b.c.d) is judged and keyed as the IPv4 address.
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      const [a = 0, b = 0] = [g[6] ?? 0, g[7] ?? 0];
      return { version: 4, octets: [a >> 8, a & 255, b >> 8, b & 255] };
    }
  }
  return parsed;
}

/** True for loopback, private, link-local, unspecified, CGNAT, multicast and reserved ranges. */
function isNonPublic(ip: ParsedIp): boolean {
  if (ip.version === 4) {
    const [a = 0, b = 0] = ip.octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const [g0 = 0] = ip.groups;
  const rest = ip.groups.slice(0, 7).every((x) => x === 0);
  return (
    (rest && (ip.groups[7] === 0 || ip.groups[7] === 1)) ||
    (g0 & 0xfe00) === 0xfc00 ||
    (g0 & 0xffc0) === 0xfe80 ||
    (g0 & 0xff00) === 0xff00
  );
}

/** Canonical rate-limit key: dotted quad for IPv4, the /64 prefix (`h:h:h:h::/64`) for IPv6. */
function toKey(ip: ParsedIp): string {
  if (ip.version === 4) return ip.octets.join('.');
  return `${ip.groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/**
 * Pure client-IP resolution. Only the XFF entry `trustedHops` positions from the right is
 * considered; entries further left are client-forgeable and ignored. If that entry is missing,
 * malformed or non-public, the socket address is used (local development). Never throws.
 */
export function resolveClientIp(input: ResolveClientIpInput): string {
  const { forwardedFor, socketAddress, trustedHops } = input;
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const entries = typeof header === 'string' && header.trim() !== '' ? header.split(',') : [];
  if (Number.isInteger(trustedHops) && trustedHops >= 1) {
    const raw = entries[entries.length - trustedHops];
    if (raw !== undefined) {
      const parsed = parseIp(raw);
      if (parsed && !isNonPublic(parsed)) return toKey(parsed);
    }
  }
  const socket = socketAddress === undefined ? null : parseIp(socketAddress);
  return socket ? toKey(socket) : UNKNOWN;
}

/** Client key for rate limiting etc., using the same hop count as Fastify's `trustProxy`. */
export function getClientIp(request: ClientIpRequest): string {
  return resolveClientIp({
    forwardedFor: request.headers['x-forwarded-for'],
    socketAddress: request.socket.remoteAddress,
    trustedHops: TRUSTED_PROXY_HOPS,
  });
}
