# Logging conventions

Structured JSON on stdout (pino, `api/src/http/logging/logger.ts`); Cloud Run forwards it to Cloud Logging. Certificates contain personal data, so logs must not become a second copy of it (data minimisation).

## Field schema

| Field                                    | Meaning                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `severity`                               | `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`                                |
| `message`                                | short, constant text; never interpolate user input                             |
| `timestamp`                              | RFC 3339, UTC                                                                  |
| `requestId`                              | added once by the request logger (`requestIdLogLabel`); never pass it manually |
| `logging.googleapis.com/trace`           | trace correlation, when `X-Cloud-Trace-Context` is present                     |
| `route`                                  | route pattern (`/api/v1/admin/certificates/:id`), never the concrete URL       |
| `status`, `latencyMs`, `method`          | access log (`request completed`, one line per request)                         |
| `adminUid`                               | Firebase uid of the administrator, when authenticated                          |
| `event`                                  | domain event name, for event-driven log lines                                  |
| `code`                                   | stable error code (`NOT_FOUND`, `VALIDATION_FAILED`, ...)                      |
| `audit`, `action`, `entityId`, `outcome` | audit entries, see below                                                       |

## Allowed identifiers

Certificate ID, organization ID, event ID, template reference, admin uid, task name and sequence number. Counts and sizes are fine.

## Forbidden content

E-mail addresses, owner names, subjects, skills, ID tokens and any other credentials, password-setup links, request and response bodies, raw headers, and user-controlled strings (path segments of unknown IDs, query values). `createLogger` redacts the keys `email`, `token`, `password`, `apiKey` and `ownerName` as a safety net; do not rely on it.

Unknown public IDs: the 404 is logged at `INFO` with `code` and `status` only; the access log carries the route pattern, so the attacker-supplied ID never reaches the logs.

## Audit entries

Every admin mutation that succeeded writes exactly one `INFO` line through `audit()` (`api/src/http/audit.ts`): `audit: true`, `action`, `entityId`, `adminUid`, `outcome: "success"` plus further identifiers (for example `organizationId`). Rejected or failed mutations write no audit entry (the `request rejected` / error line covers them).

Current actions: `organization.create|rename|delete`, `event.create|update|delete`, `template.created|copied|previewed`, `certificate.issued`, `certificate.bulk_issued`, `certificate.revoked`. Actions of features that do not exist yet (certificate e-mail change, e-mail resend) must be added here with the feature, using the same helper.

Filter: `jsonPayload.audit=true`.

### Retention decision

Cloud Logging's `_Default` bucket keeps logs for 30 days. A dedicated log bucket with 400-day retention for audit entries is a live-project change (log bucket plus sink, billed by storage) and is not created from this repository; until it is decided and provisioned, the **default 30 days is accepted** and recorded here. Tracked with the observability infrastructure task.

### Volume estimate

Per request: one access line (about 350 bytes) plus one authentication line on admin requests; audit lines only for mutations. At 10,000 requests per month this is about 7 MB, well below 50 MB per month and the free 50 GiB per project allowance.

## Tests

- `test/unit/log-privacy.test.ts` runs the log-emitting flows at `debug` level and fails when any line contains an e-mail-shaped string, a JWT-shaped string or a seeded owner name, subject or skill (helpers in `test/helpers/log-capture.ts`; reuse `captureLogs` and `privacyViolations` in other suites).
- `test/unit/logging.test.ts` covers the line format, `requestId` appearing once and trace correlation.
