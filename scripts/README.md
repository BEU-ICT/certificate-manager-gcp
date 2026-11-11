# scripts

Operational scripts: migrations, legacy import, verification.

## verify-pdf-lifecycle

`npm run verify:pdf-lifecycle` checks the revocation guarantee (BEU-ICT/certificate-manager#360) against a deployed environment.

Required environment:

- `API_BASE_URL`: API origin, e.g. `https://api.example.org`.
- `ADMIN_ID_TOKEN`: Firebase ID token of an administrator (bearer; never printed).
- `TEST_ORG_ID`, `TEST_EVENT_ID`: a **dedicated, labelled test organization** and one of its events.
- Optional: `TEST_TEMPLATE_ID` (`<name>-v<n>`; default latest), `TEST_CERTIFICATE_TYPE` (default `attendance`).
- Flag `--skip-bucket-listing` omits the anonymous bucket listing check.

Steps (each prints `PASS`/`FAIL`; the first failure stops the run with a non-zero exit code): issue a certificate for a synthetic recipient (`Lifecycle Test <random>`, no e-mail) -> public details are `active` with a `pdfUrl` -> `GET .../pdf` answers 302 -> public details now show a `pdfUrl` equal to the redirect target (PDFs are generated lazily) -> the bucket URL returns 200 with `Cache-Control: no-cache`, `application/pdf` and a `%PDF` body -> revoke -> public details are `revoked` with `pdfUrl: null` -> the earlier bucket URL returns 404/403 -> `.../pdf` returns 410 -> replaying `If-None-Match` / `If-Modified-Since` returns 404/403, never 304 -> anonymous bucket listing is refused. A certificate that was issued is revoked in all cases If that cleanup revocation fails the run fails and prints `CLEANUP FAILED certificate <id> must be revoked manually`. Every request times out after 30 s. Exit codes: 0 pass, 1 failure (or unexpected error), 2 missing configuration. (Revoked certificates remain by design; only the certificate id is printed).

The acceptance run needs a deployed, production-like environment with live GCP. The CI mode against the emulators with the fs storage adapter (without the listing step) is deferred until that adapter exists. The logic lives in `api/scripts/lib/pdf-lifecycle.ts` and is unit-tested with a fake fetch (`api/test/unit/pdf-lifecycle.test.ts`).
