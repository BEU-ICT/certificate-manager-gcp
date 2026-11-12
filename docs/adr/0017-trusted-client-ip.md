# 0017 Trusted client IP behind Firebase Hosting and Cloud Run

Status: proposed · Spec §10 · Issue/PR: BEU-ICT/certificate-manager#388 (story BEU-ICT/certificate-manager#386, consumer BEU-ICT/certificate-manager#387)

## Context

Public requests reach Cloud Run through Firebase Hosting. The rate limiter (BEU-ICT/certificate-manager#387) needs a client key that an attacker cannot rotate. `X-Forwarded-For` (XFF) may contain client-supplied entries, so a key taken from the wrong position, or from a header such as `X-Real-IP` or `Fastly-Client-IP`, lets one machine dodge the limit.

The issue asks for a spike on the live service. That was not possible when this ADR was written (no live cloud actions), so **the header layout below is assumed from Google's documentation and is UNVERIFIED**.

## Assumed header layout (UNVERIFIED)

Firebase Hosting front end -> Cloud Run:

```
X-Forwarded-For: <client-supplied entries...>, <client IP as seen by Hosting>, [Google front-end hops appended by Cloud Run]
```

- Entries left of the Hosting-observed address are client-forgeable.
- The number of Google-appended entries on the right is not known; it is the configurable hop count (`TRUSTED_PROXY_HOPS`, currently 1).
- `X-Real-IP` and `Fastly-Client-IP` are assumed to be forwardable by the client or set by infrastructure we do not control; their behaviour is unknown.

## Decision

We will take the client IP only from XFF, at the entry `TRUSTED_PROXY_HOPS` positions from the right (`api/src/http/client-ip.ts`, `getClientIp`). Entries further left are ignored. The same constant feeds Fastify's `trustProxy`, so `request.ip` and the limiter key cannot drift (covered by a unit test).

We will never trust `X-Real-IP` or `Fastly-Client-IP` unless the spike below shows they are set by Google and cannot be forged.

Selected entries that are malformed or non-public (loopback, private, link-local, CGNAT, multicast, unspecified, IPv4-mapped variants) are not accepted; the socket address is used instead (local development, never throws). IPv6 is keyed by its /64 prefix; IPv4 by its canonical dotted quad; ports and zone ids are stripped; oddly formatted IPv4 (leading zeros, hex) is malformed. The IP is never logged in plaintext by this code.

## Spike procedure to run later on live GCP

Acceptance criterion 1 of BEU-ICT/certificate-manager#388 (50 requests with random forged XFF still limited after 10, against the deployed service) is **NOT verified**.

1. On a throwaway, flag-guarded revision (never merged), echo the raw `X-Forwarded-For`, `Fastly-Client-IP`, `X-Real-IP`, `Forwarded` headers and the socket address.
2. From one machine with a known public IP, send requests: no extra headers; forged `X-Forwarded-For: 1.2.3.4`; forged `X-Forwarded-For: 1.2.3.4, 5.6.7.8`; forged `Fastly-Client-IP` and `X-Real-IP`. Repeat over IPv4 and IPv6, via the `*.web.app` and the custom Hosting domain.
3. Record, per request: the full XFF, the position (from the right) of the true client IP, which headers survive or are overwritten, and the socket address. Attach the output to BEU-ICT/certificate-manager#388.
4. Pick the hop count as the number of entries from the right up to and including the true client IP; set `TRUSTED_PROXY_HOPS` accordingly and update this ADR (status to accepted, assumptions to evidence).
5. Run the 50-forged-XFF check against the limiter of BEU-ICT/certificate-manager#387 and attach the output.

## Re-check when the traffic path changes

Repeat the spike if any of these change: a custom domain on Hosting, a global external load balancer or Cloud CDN/Armor in front of Cloud Run, direct use of the `run.app` URL, a Hosting rewrite change, or any extra proxy. Each adds or removes hops and changes the hop count.

## Consequences

- If the real hop count differs from 1, the key is either a Google address (all clients share one bucket; limiter too strict) or a forgeable entry (limiter bypass). The second is the dangerous case, hence the verification gap is recorded openly.
- Requests whose selected entry is invalid collapse into the socket-address bucket (fail closed).
- IPv6 clients in the same /64 share a bucket.

## Follow-ups and known limitations

- `getClientIp` has no caller yet. BEU-ICT/certificate-manager#387 must key all limiters on it; `admin-guard.ts` and `internal-send-email.ts` still use `request.ip` (not /64-normalised) until then.
- With a hop count above 1 and fewer `X-Forwarded-For` entries than hops, Fastify's `request.ip` returns the leftmost entry while `getClientIp` falls back to the socket address. Both are safe; the default of 1 behaves identically. Re-check after the spike changes the hop count.
- The non-public denylist omits documentation and benchmark ranges and does not unwrap NAT64, 6to4 or IPv4-compatible IPv6 forms. Not exploitable, since the selected hop is not client-controlled.
