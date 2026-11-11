/**
 * `npm run verify:pdf-lifecycle`: checks the revocation guarantee against a deployed environment
 * (BEU-ICT/certificate-manager#360). See scripts/README.md. Exits non-zero on the first failing step.
 *
 * Env: API_BASE_URL, ADMIN_ID_TOKEN, TEST_ORG_ID, TEST_EVENT_ID; optional TEST_TEMPLATE_ID,
 * TEST_CERTIFICATE_TYPE. Flag: --skip-bucket-listing.
 */
import { verifyPdfLifecycle } from '../api/scripts/lib/pdf-lifecycle.js';

async function main(): Promise<void> {
  const required = ['API_BASE_URL', 'ADMIN_ID_TOKEN', 'TEST_ORG_ID', 'TEST_EVENT_ID'] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    process.stderr.write(`verify-pdf-lifecycle: missing environment: ${missing.join(', ')}\n`);
    process.exit(2);
  }
  const env = (name: string): string => process.env[name] ?? '';

  const result = await verifyPdfLifecycle({
    apiBaseUrl: env('API_BASE_URL'),
    adminIdToken: env('ADMIN_ID_TOKEN'),
    organizationId: env('TEST_ORG_ID'),
    eventId: env('TEST_EVENT_ID'),
    templateId: process.env['TEST_TEMPLATE_ID'] || undefined,
    type: process.env['TEST_CERTIFICATE_TYPE'] || undefined,
    skipBucketListing: process.argv.includes('--skip-bucket-listing'),
    log: (line) => process.stdout.write(`${line}\n`),
  });

  if (result.cleanupFailed === true) {
    process.stdout.write(
      `CLEANUP FAILED certificate ${result.certificateId ?? '?'} must be revoked manually\n`,
    );
  }
  process.stdout.write(
    `${result.ok ? (result.listingSkipped === true ? 'RESULT PASS (listing skipped)' : 'RESULT PASS') : 'RESULT FAIL'}${result.certificateId === undefined ? '' : ` (certificate ${result.certificateId})`}\n`,
  );
  process.exit(result.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `verify-pdf-lifecycle: ${error instanceof Error ? error.message : 'unexpected error'}\n`,
  );
  process.exit(1);
});
