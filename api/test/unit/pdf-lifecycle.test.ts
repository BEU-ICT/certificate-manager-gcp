import { describe, expect, it } from 'vitest';
import { verifyPdfLifecycle } from '../../scripts/lib/pdf-lifecycle.js';

const API = 'https://api.test';
const BUCKET = 'https://pdfs.test';
const OBJECT = `${BUCKET}/pdfs/tok.pdf`;

interface Behaviour {
  /** Status for conditional requests after revocation. */
  conditionalAfterRevoke?: number;
  /** Status for plain bucket GET after revocation. */
  bucketAfterRevoke?: number;
  listingStatus?: number;
  noCacheHeader?: boolean;
  noContentType?: boolean;
  pdfAfterRevoke?: number;
  revokeStatus?: number;
  noEtag?: boolean;
}

function fakeApi(behaviour: Behaviour = {}) {
  const calls: string[] = [];
  let revoked = false;
  let pdfCalled = false;
  let revokeCalls = 0;
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fakeFetch: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push(`${method} ${url}`);
    const done = (r: Response) => Promise.resolve(r);

    if (method === 'POST' && url === `${API}/api/v1/admin/certificates`) {
      return done(json(201, { id: 'cert1' }));
    }
    if (method === 'POST' && url === `${API}/api/v1/admin/certificates/cert1/revoke`) {
      revokeCalls += 1;
      if (behaviour.revokeStatus !== undefined) return done(json(behaviour.revokeStatus, {}));
      revoked = true;
      return done(json(200, { id: 'cert1', status: 'revoked', warnings: [] }));
    }
    if (url === `${API}/api/v1/public/certificates/cert1`) {
      return done(
        json(
          200,
          revoked
            ? { status: 'revoked', pdfUrl: null }
            : { status: 'active', pdfUrl: pdfCalled ? OBJECT : null },
        ),
      );
    }
    if (url === `${API}/api/v1/public/certificates/cert1/pdf`) {
      if (revoked) return done(json(behaviour.pdfAfterRevoke ?? 410, {}));
      pdfCalled = true;
      return done(new Response(null, { status: 302, headers: { location: OBJECT } }));
    }
    if (url === OBJECT) {
      if (!revoked) {
        return done(
          new Response('%PDF-1.7 body', {
            status: 200,
            headers: {
              ...(behaviour.noContentType === true ? {} : { 'content-type': 'application/pdf' }),
              ...(behaviour.noCacheHeader === false ? {} : { 'cache-control': 'no-cache' }),
              ...(behaviour.noEtag === true ? {} : { etag: '"abc"' }),
              'last-modified': 'Wed, 01 Jan 2026 00:00:00 GMT',
            },
          }),
        );
      }
      const conditional = headers.has('if-none-match') || headers.has('if-modified-since');
      const status = conditional
        ? (behaviour.conditionalAfterRevoke ?? 404)
        : (behaviour.bucketAfterRevoke ?? 404);
      return done(new Response(null, { status }));
    }
    if (url.startsWith(`${BUCKET}/`))
      return done(new Response('', { status: behaviour.listingStatus ?? 403 }));
    return done(new Response(null, { status: 500 }));
  };
  return { fakeFetch, calls, revokeCalls: () => revokeCalls };
}

const run = (fake: ReturnType<typeof fakeApi>, extra: { skipBucketListing?: boolean } = {}) => {
  const lines: string[] = [];
  const result = verifyPdfLifecycle({
    apiBaseUrl: API,
    adminIdToken: 'secret-token',
    organizationId: 'org',
    eventId: 'ev',
    fetch: fake.fakeFetch,
    log: (l) => lines.push(l),
    random: () => 'abc',
    ...extra,
  });
  return result.then((r) => ({ r, lines }));
};

describe('verifyPdfLifecycle', () => {
  it('passes on the happy path and never logs the token', async () => {
    const { r, lines } = await run(fakeApi());
    expect(r.ok).toBe(true);
    expect(r.certificateId).toBe('cert1');
    expect(r.steps.every((s) => s.ok)).toBe(true);
    expect(lines.join('\n')).not.toContain('secret-token');
  });

  it('fails when a conditional request returns 304 after revocation', async () => {
    const { r, lines } = await run(fakeApi({ conditionalAfterRevoke: 304 }));
    expect(r.ok).toBe(false);
    expect(r.steps.at(-1)).toMatchObject({ step: 'conditional-requests', ok: false });
    expect(lines.some((l) => l.startsWith('FAIL conditional-requests'))).toBe(true);
  });

  it('fails when the bucket still serves the object after revocation', async () => {
    const fake = fakeApi({ bucketAfterRevoke: 200 });
    const { r } = await run(fake);
    expect(r.ok).toBe(false);
    expect(r.steps.at(-1)).toMatchObject({ step: 'bucket-url-blocked', ok: false });
    // Stops at the first failing step: nothing after it ran.
    expect(r.steps.some((s) => s.step === 'pdf-endpoint-gone')).toBe(false);
  });

  it('fails when anonymous bucket listing is allowed, unless skipped', async () => {
    const { r } = await run(fakeApi({ listingStatus: 200 }));
    expect(r.ok).toBe(false);
    expect(r.steps.at(-1)).toMatchObject({ step: 'bucket-listing-denied', ok: false });
    const skipped = await run(fakeApi({ listingStatus: 200 }), { skipBucketListing: true });
    expect(skipped.r.ok).toBe(true);
  });

  it('stops at the first failing step and still revokes the issued certificate', async () => {
    const fake = fakeApi({ noCacheHeader: false });
    const { r } = await run(fake);
    expect(r.ok).toBe(false);
    expect(r.steps.map((s) => s.step)).toEqual([
      'issue',
      'public-details-active',
      'pdf-redirect',
      'public-details-pdf-url',
      'bucket-download',
    ]);
    expect(fake.revokeCalls()).toBe(1);
  });

  it('fails when the pdfUrl is still null after the PDF was requested', async () => {
    const fake = fakeApi();
    const wrapped: typeof fetch = async (input, init) => {
      const res = await fake.fakeFetch(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === `${API}/api/v1/public/certificates/cert1` && (init?.method ?? 'GET') === 'GET') {
        const body = (await res.clone().json()) as { status: string };
        if (body.status === 'active')
          return new Response(JSON.stringify({ status: 'active', pdfUrl: null }), { status: 200 });
      }
      return res;
    };
    const { r } = await run({ ...fake, fakeFetch: wrapped });
    expect(r.ok).toBe(false);
    expect(r.steps.at(-1)).toMatchObject({ step: 'public-details-pdf-url', ok: false });
  });

  it('fails the run when the cleanup revocation fails', async () => {
    const { r, lines } = await run(fakeApi({ noContentType: true, revokeStatus: 500 }));
    expect(r.ok).toBe(false);
    expect(r.cleanupFailed).toBe(true);
    expect(lines).toContain('CLEANUP FAILED certificate cert1 must be revoked manually');
  });

  it('fails on a missing Content-Type', async () => {
    const { r, lines } = await run(fakeApi({ noContentType: true }));
    expect(r.steps.at(-1)).toMatchObject({ step: 'bucket-download', ok: false });
    expect(lines.join('\n')).not.toContain('secret-token');
  });

  it('fails when the pdf endpoint does not return 410 after revocation', async () => {
    const { r } = await run(fakeApi({ pdfAfterRevoke: 302 }));
    expect(r.steps.at(-1)).toMatchObject({ step: 'pdf-endpoint-gone', ok: false });
  });

  it('fails clearly when the first download has no ETag to replay', async () => {
    const { r } = await run(fakeApi({ noEtag: true }));
    expect(r.steps.at(-1)).toMatchObject({ step: 'conditional-requests', ok: false });
  });
});
