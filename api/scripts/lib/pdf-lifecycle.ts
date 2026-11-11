/**
 * PDF lifecycle verification (BEU-ICT/certificate-manager#360): issue -> public details -> PDF
 * redirect -> bucket download -> revoke -> revoked details -> bucket 404/403 -> `/pdf` 410 ->
 * conditional requests never 304 -> anonymous bucket listing fails.
 *
 * Pure logic with an injectable `fetch`, so it is unit-tested against a fake API and bucket. The
 * bearer token is only ever sent in the `Authorization` header and never logged or returned.
 */

export interface LifecycleOptions {
  apiBaseUrl: string;
  /** Administrator ID token (bearer). Never logged. */
  adminIdToken: string;
  organizationId: string;
  eventId: string;
  templateId?: string | undefined;
  type?: string | undefined;
  skipBucketListing?: boolean | undefined;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
  /** Receives one line per step result, e.g. `PASS issue: ...`. */
  log?: ((line: string) => void) | undefined;
  /** Random suffix source for the synthetic recipient name. */
  random?: (() => string) | undefined;
}

export interface StepResult {
  step: string;
  ok: boolean;
  message: string;
}

export interface LifecycleResult {
  ok: boolean;
  /** True when the cleanup revocation of an issued certificate failed: it must be revoked manually. */
  cleanupFailed?: boolean | undefined;
  /** True when the listing step was skipped. */
  listingSkipped?: boolean | undefined;
  /** Present once issuance succeeded. */
  certificateId?: string | undefined;
  steps: StepResult[];
}

class StepFailure extends Error {}

const trimSlashes = (url: string): string => url.replace(/\/+$/, '');
const BLOCKED = new Set([403, 404]);

export async function verifyPdfLifecycle(options: LifecycleOptions): Promise<LifecycleResult> {
  const doFetch = options.fetch ?? fetch;
  const log = options.log ?? (() => undefined);
  const api = trimSlashes(options.apiBaseUrl);
  const steps: StepResult[] = [];
  let certificateId: string | undefined;
  let revoked = false;
  let cleanupFailed = false;
  let listingSkipped = false;

  const auth = { authorization: `Bearer ${options.adminIdToken}` };
  const send = (url: string, init: RequestInit = {}): Promise<Response> =>
    doFetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      ...init,
    });

  async function step(name: string, run: () => Promise<string>): Promise<void> {
    try {
      const message = await run();
      steps.push({ step: name, ok: true, message });
      log(`PASS ${name}: ${message}`);
    } catch (error) {
      const message =
        error instanceof StepFailure
          ? error.message
          : `unexpected error (${error instanceof Error ? error.name : 'unknown'})`;
      steps.push({ step: name, ok: false, message });
      log(`FAIL ${name}: ${message}`);
      throw error;
    }
  }

  const expect = (condition: boolean, message: string): void => {
    if (!condition) throw new StepFailure(message);
  };
  const readJson = async (response: Response): Promise<Record<string, unknown>> => {
    const body: unknown = await response.json().catch(() => null);
    expect(typeof body === 'object' && body !== null, 'response body is not a JSON object');
    return body as Record<string, unknown>;
  };

  const revoke = async (): Promise<Response> =>
    send(`${api}/api/v1/admin/certificates/${encodeURIComponent(certificateId ?? '')}/revoke`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Automated PDF lifecycle verification' }),
    });

  let bucketUrl = '';
  let etag: string | null = null;
  let lastModified: string | null = null;

  try {
    await step('issue', async () => {
      const suffix = (options.random ?? (() => Math.random().toString(36).slice(2, 10)))();
      const response = await send(`${api}/api/v1/admin/certificates`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: options.organizationId,
          eventId: options.eventId,
          ...(options.templateId === undefined ? {} : { templateId: options.templateId }),
          type: options.type ?? 'attendance',
          ownerName: `Lifecycle Test ${suffix}`,
          subject: 'Automated PDF lifecycle verification',
        }),
      });
      expect(response.status === 201, `expected 201 from issuance, got ${String(response.status)}`);
      const body = await readJson(response);
      expect(typeof body['id'] === 'string' && body['id'] !== '', 'issuance returned no id');
      certificateId = body['id'] as string;
      return `issued certificate ${certificateId}`;
    });

    const id = encodeURIComponent(certificateId ?? '');
    const detailsUrl = `${api}/api/v1/public/certificates/${id}`;
    const pdfEndpoint = `${detailsUrl}/pdf`;

    await step('public-details-active', async () => {
      const response = await send(detailsUrl);
      expect(response.status === 200, `expected 200, got ${String(response.status)}`);
      const body = await readJson(response);
      expect(body['status'] === 'active', `expected status active, got ${String(body['status'])}`);
      return 'status active';
    });

    await step('pdf-redirect', async () => {
      const response = await send(pdfEndpoint);
      expect(response.status === 302, `expected 302, got ${String(response.status)}`);
      const location = response.headers.get('location');
      expect(location !== null && location !== '', 'redirect has no Location header');
      bucketUrl = new URL(location ?? '', pdfEndpoint).toString();
      return 'redirected to the bucket URL';
    });

    await step('public-details-pdf-url', async () => {
      const response = await send(detailsUrl);
      expect(response.status === 200, `expected 200, got ${String(response.status)}`);
      const body = await readJson(response);
      const pdfUrl = body['pdfUrl'];
      expect(typeof pdfUrl === 'string' && pdfUrl !== '', 'pdfUrl is not set after generation');
      expect(
        new URL(pdfUrl as string, detailsUrl).toString() === bucketUrl,
        'pdfUrl does not match the redirect Location',
      );
      return 'pdfUrl set and matches the bucket URL';
    });

    await step('bucket-download', async () => {
      const response = await send(bucketUrl);
      expect(response.status === 200, `expected 200, got ${String(response.status)}`);
      const cacheControl = response.headers.get('cache-control') ?? '';
      expect(
        /(^|[\s,])no-cache($|[\s,;])/i.test(cacheControl),
        `Cache-Control must include no-cache, got "${cacheControl}"`,
      );
      const contentType = response.headers.get('content-type') ?? '';
      expect(
        contentType.toLowerCase().startsWith('application/pdf'),
        `Content-Type must be application/pdf, got "${contentType}"`,
      );
      const head = new TextDecoder('latin1').decode((await response.arrayBuffer()).slice(0, 5));
      expect(head === '%PDF-', 'body does not start with %PDF');
      etag = response.headers.get('etag');
      lastModified = response.headers.get('last-modified');
      return 'status 200, no-cache, application/pdf, %PDF body';
    });

    await step('revoke', async () => {
      const response = await revoke();
      expect(response.status === 200, `expected 200, got ${String(response.status)}`);
      revoked = true;
      const body = await readJson(response);
      const warnings = body['warnings'];
      expect(
        !Array.isArray(warnings) || warnings.length === 0,
        `revocation reported warnings: ${JSON.stringify(warnings)}`,
      );
      return 'certificate revoked';
    });

    await step('public-details-revoked', async () => {
      const response = await send(detailsUrl);
      expect(response.status === 200, `expected 200, got ${String(response.status)}`);
      const body = await readJson(response);
      expect(
        body['status'] === 'revoked',
        `expected status revoked, got ${String(body['status'])}`,
      );
      expect(body['pdfUrl'] === null, 'pdfUrl must be null after revocation');
      return 'status revoked, pdfUrl null';
    });

    await step('bucket-url-blocked', async () => {
      const response = await send(bucketUrl);
      expect(
        BLOCKED.has(response.status),
        `earlier bucket URL must return 404 or 403, got ${String(response.status)}`,
      );
      return `bucket URL returns ${String(response.status)}`;
    });

    await step('pdf-endpoint-gone', async () => {
      const response = await send(pdfEndpoint);
      expect(response.status === 410, `expected 410, got ${String(response.status)}`);
      return 'pdf endpoint returns 410';
    });

    await step('conditional-requests', async () => {
      const checked: string[] = [];
      const check = async (header: string, value: string | null): Promise<void> => {
        expect(
          value !== null && value !== '',
          `the first download has no ${header === 'If-None-Match' ? 'ETag' : 'Last-Modified'} header to replay`,
        );
        const response = await send(bucketUrl, { headers: { [header]: value as string } });
        expect(
          BLOCKED.has(response.status),
          `${header} request must return 404 or 403 (never 304), got ${String(response.status)}`,
        );
        checked.push(header);
      };
      await check('If-None-Match', etag);
      await check('If-Modified-Since', lastModified);
      return `${checked.join(' and ')} answered 404/403, not 304`;
    });

    if (options.skipBucketListing === true) {
      listingSkipped = true;
      log('SKIP bucket-listing: --skip-bucket-listing');
    } else {
      await step('bucket-listing-denied', async () => {
        const cut = bucketUrl.indexOf('/pdfs/');
        const root = cut >= 0 ? bucketUrl.slice(0, cut + 1) : new URL('/', bucketUrl).toString();
        for (const url of [root, `${root}?prefix=`]) {
          const response = await send(url);
          expect(
            response.status !== 200,
            `anonymous bucket listing is allowed (GET ${url} returned 200)`,
          );
        }
        return 'anonymous bucket listing is refused';
      });
    }
  } catch {
    // The failing step is already recorded; fall through to cleanup.
  } finally {
    if (certificateId !== undefined && !revoked) {
      try {
        const response = await revoke();
        if (response.status === 200) {
          log('CLEANUP revoked the test certificate');
        } else {
          cleanupFailed = true;
          log(`CLEANUP revocation failed with ${String(response.status)}`);
        }
      } catch {
        cleanupFailed = true;
        log('CLEANUP revocation failed');
      }
      if (cleanupFailed)
        log(`CLEANUP FAILED certificate ${certificateId} must be revoked manually`);
    }
  }

  return {
    ok: steps.every((s) => s.ok) && steps.length > 0 && !cleanupFailed,
    cleanupFailed,
    listingSkipped,
    certificateId,
    steps,
  };
}
