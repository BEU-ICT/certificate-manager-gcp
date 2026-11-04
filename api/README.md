# api

Node.js + TypeScript + Fastify backend, deployed to Cloud Run. See BEU-ICT/certificate-manager#27.

## Configuration

All configuration comes from environment variables, validated once at boot by `loadConfig(env)` in `src/config.ts` (zod). Copy `.env.example` to `.env` for local development; it lists every variable with a comment. If validation fails, the process prints every violation (variable name and reason, never a value) to stderr and exits with code 1 before listening.

- Outside `NODE_ENV=production`, unset variables fall back to local defaults (in-memory adapters, emulator project). In production the project, URLs, e-mail sender and adapter selectors are required, URLs must be `https`, and `memory`/`in-process` adapters are rejected.
- Only `src/server.ts` reads `process.env`; everything else receives the frozen `Config` object.

Feature flags are documented in [Feature flags](#feature-flags).

## Feature flags

The registry in `src/flags.ts` is the single source of truth: each flag has an environment variable, default and description. `config.ts` only passes the environment in and exposes the result as the typed, frozen `config.flags` object (e.g. `config.flags.openApiEndpoint`). Values are `true|false|1|0`; invalid values and unknown `FEATURE_*` variables fail boot, so typos are caught. Removing a flag is a change to `flags.ts` plus its usages.

| Variable                        | Key                   | Default                         | Purpose                                              |
| ------------------------------- | --------------------- | ------------------------------- | ---------------------------------------------------- |
| `FEATURE_OPENAPI_ENDPOINT`      | `openApiEndpoint`     | off in production, on elsewhere | Serve the OpenAPI document                           |
| `FEATURE_BOUNCE_JOB`            | `bounceJob`           | off (until #161 is verified)    | Bounce-processing job                                |
| `FEATURE_EMAIL_FALLBACK`        | `emailFallback`       | on                              | Use `EMAIL_FALLBACK_PROVIDER` when the primary fails |
| `FEATURE_BULK_ISSUANCE`         | `bulkIssuance`        | on                              | Bulk certificate issuance                            |
| `FEATURE_PUBLIC_PDF_GENERATION` | `publicPdfGeneration` | on                              | On-demand public PDF generation (kill switch)        |

Usage: `createFeatureFlags(config.flags)` gives a `FeatureFlags` (`isEnabled(name)`), passed to `buildApp({ flags })` and to modules as a dependency. Guard a route with `requireFlag(flags, 'bulkIssuance')` from `src/http/flag-guard.ts` (`onRequest` hook) or call `assertFlagEnabled` in a handler: when the flag is off the route answers `404 NOT_FOUND` (hidden), except kill-switch flags (`killSwitch: true` in the registry, currently `publicPdfGeneration`), which answer `503 UNAVAILABLE`.

Admin UI: `buildAdminFeatures(flags)` builds the `features` object (`bulkIssuance`, `publicPdfGeneration`; internal switches are not exposed) that `GET /api/v1/admin/me` will include so the UI can hide disabled actions. That route does not exist yet (it arrives with the auth/admin routes); it must return this builder's result as `features`.

## Container image

`api/Dockerfile` is multi-stage (build, production deps, runtime) with base images pinned by digest. The runtime stage is plain Alpine plus the `node` binary (no npm/yarn), runs as non-root UID 10001 and is about 230 MB. It only references files inside `api/`, so `gcloud run deploy --source .` from `api/` works.

```bash
cd api
docker build -t certificate-manager-api .
# Local run: in-memory adapters from .env.example, no GCP credentials needed.
# The image sets NODE_ENV=production, which refuses memory adapters, so the env file overrides it.
docker run --rm --read-only --tmpfs /tmp --env-file .env.example -p 8080:8080 certificate-manager-api
curl localhost:8080/internal/healthz
```

Notes:

- The image does not need an init wrapper: `src/server.ts` handles SIGTERM itself (graceful shutdown, exit 0).
- `api/package-lock.json` is a standalone lockfile used only by the Docker build (the build context has no workspace root). Regenerate it when `api/package.json` dependencies change: copy `package.json` to an empty directory and run `npm install --package-lock-only` there.
- Updating a base image: pull the new tag, read its digest with `docker inspect --format '{{index .RepoDigests 0}}' <tag>` and replace the `ARG` values at the top of the Dockerfile.

## Architecture boundaries

The ports-and-adapters layout (ADR `docs/adr/0001-ports-and-adapters.md`) is enforced by tooling, not by convention. Both checks are part of CI:

```bash
npm run lint                 # ESLint: vendor imports, src/testing, DocumentReference (eslint.boundaries.js)
npm run depcruise            # dependency-cruiser: layering, module isolation, cycles (.dependency-cruiser.cjs)
npm run check:architecture   # depcruise + the DocumentReference grep guard
npm run test:architecture    # negative tests (also run by `npm test`)
```

### ESLint rules (`eslint.boundaries.js`)

| Rule                                                                                                                                                                                                                                                                                                | Where                                                                           | Notes                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Vendor packages are forbidden: `firebase-admin`, `firebase-admin/*`, `firebase`, `@firebase/*`, `@google-cloud/*`, `googleapis`, `google-auth-library`, `nodemailer`, `pg`, `@aws-sdk/*`, `aws-sdk`, `@azure/*`, `@sendgrid/*`, database drivers, queue clients and similar (full list in the file) | Everywhere except `src/adapters/**`, `src/testing/**` and `test/integration/**` | Also catches `import()` and `require()`. Add new vendor SDKs to `VENDOR_PACKAGES`.                                      |
| `src/testing/**` may not be imported                                                                                                                                                                                                                                                                | Everything under `src/` except `src/testing/**` itself                          | `test/**` may import it. Exception: `src/adapters/memory/**` (the fakes exposed as the local-profile adapters).         |
| `DocumentReference` may not be used                                                                                                                                                                                                                                                                 | Everywhere except `src/adapters/**` and `test/integration/**`                   | Relations are plain string IDs. `npm run check:document-reference` additionally greps for the word (comments included). |

```ts
// src/modules/certificates/service.ts
import type { CertificateRepository } from '../../ports/index.js'; // allowed: depend on a port
import { Firestore } from '@google-cloud/firestore'; // forbidden: vendor SDK outside src/adapters/**
import { FakeClock } from '../../testing/fake-clock.js'; // forbidden: src/testing from production code

// src/adapters/firestore/certificate-repository.ts
import { Firestore } from '@google-cloud/firestore'; // allowed here (and under src/testing/**)
```

### dependency-cruiser rules (`.dependency-cruiser.cjs`)

| Rule name                                       | Meaning                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `modules-only-via-public-index` (a)             | `modules/<a>/**` may import `modules/<b>/index.ts` only, never `modules/<b>/internal/...`.                               |
| `modules-and-ports-not-to-adapters-or-http` (b) | `modules/**` and `ports/**` never import `adapters/**` or `http/**`.                                                     |
| `ports-only-ports-and-shared` (c)               | `ports/**` import only `ports/**` and `shared/**` (first-party code; vendor packages are covered by ESLint).             |
| `adapters-not-to-module-internals` (d)          | `adapters/**` import `ports/**` and `shared/**`; of `modules/**` only a public `index.ts` is reachable, never internals. |
| `no-circular` (e)                               | No import cycles anywhere in `src/`.                                                                                     |
| `testing-not-from-production-code` (f)          | Nothing under `src/` outside `src/testing/**` and `src/adapters/memory/**` imports `src/testing/**`.                     |

```ts
// src/modules/certificates/service.ts
import type { TemplateService } from '../templates/index.js'; // allowed: public interface of another module
import { loadLayout } from '../templates/internal/layout.js'; // forbidden (a): deep import
import { FirestoreDb } from '../../adapters/firestore/db.js'; // forbidden (b)

// src/ports/clock.ts
import type { Id } from '../shared/ids.js'; // allowed
import { CertificateService } from '../modules/certificates/index.js'; // forbidden (c)
```

### Negative tests

`test/architecture/architecture.test.ts` proves that every rule is live. The fixtures in `test/architecture/fixtures/` break each rule on purpose (including `import { Firestore } from '@google-cloud/firestore'` in a module and a cross-module deep import) and are excluded from lint, typecheck and `depcruise`. The test runs the real dependency-cruiser CLI on the miniature trees in `fixtures/depcruise/<case>/src` and lints `fixtures/eslint/*.ts` as if they lived at a given path inside `src/`, expecting failure with the right rule name. Allowed layouts are asserted to pass, so a rule cannot go silent unnoticed. When you add a rule, add a fixture for it.

## Port contract tests

Every port in `src/ports` has one executable suite in `src/testing/contracts/` that **every** adapter must pass, fakes and real ones alike (Firestore emulator now, PostgreSQL later). The suites are the specification of the TSDoc on the port. A failure message names the broken clause, for example `StorageGateway contract violated: "putIfAbsent: Exactly one of concurrent callers gets created: true" (callers with created: true: [0, 3])`.

| Suite                                                   | Port                    | Factory returns, besides `adapter` and `cleanup`                           |
| ------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `describeStorageGatewayContract(name, factory)`         | `StorageGateway`        |                                                                            |
| `describeTaskQueueContract(name, factory)`              | `TaskQueue`             | optional `pending()` listing queued tasks, enables the `scheduleAt` checks |
| `describeEventBusContract(name, factory)`               | `EventBus`              |                                                                            |
| `describeRateLimiterContract(name, factory)`            | `RateLimiter`           | `clock` the adapter reads and `advance(ms)` to move it                     |
| `describeClockContract` / `describeIdGeneratorContract` | `Clock` / `IdGenerator` |                                                                            |

`factory` is called once per test and must return a **fresh, empty** adapter plus a `cleanup` callback (it may be async). Real adapters reset or namespace their store in the factory and undo it in `cleanup`.

### Adding an adapter

1. Copy the `*.contract.test.ts` file of the port from `test/unit/contracts/`. In-memory adapters stay in `test/unit/contracts/` (run by `npm run test:unit`); adapters that need an emulator or database go to `test/integration/` (run by `npm run test:integration`).
2. Replace the adapter construction and call the suite:

   ```ts
   // test/integration/firestore-storage.contract.test.ts
   import { describeStorageGatewayContract } from '../../src/testing/contracts/index.js';
   import { createFirestoreStorage } from '../../src/adapters/firestore/storage.js';

   describeStorageGatewayContract('FirestoreStorageGateway (emulator)', async () => {
     const storage = await createFirestoreStorage({ namespace: crypto.randomUUID() });
     return { adapter: storage, cleanup: () => storage.deleteNamespace() };
   });
   ```

3. Fix the adapter until the suite is green. If a clause looks wrong for your backend, change the port's TSDoc and the suite together in the same PR, never the suite alone.

Repository suites are added by the epics that define the repositories, using the same `ContractFactory` shape (`src/testing/contracts/types.ts`).

`test/unit/contracts/harness.test.ts` proves the harness itself: it runs deliberately broken adapters (`fixtures/broken-adapters.fixture.ts`) through the real suites in a nested Vitest run and asserts that they fail and name the violated clause. The fixture does not match `*.test.ts`, so the normal run never contains a failing test.

## Integration tests

Integration tests run against the Firebase Emulator Suite (Firestore and Auth). They live in `test/integration/` as `*.integration.test.ts`, use their own config (`vitest.integration.config.ts`) and are excluded from `npm test` and `npm run test:unit`.

```bash
npm run test:integration   # from api/ or: npm run test:integration -w api (repo root)
```

Requirements: Node (see `.nvmrc`) and a JDK 21+ (`java -version`). `firebase-tools` is a devDependency; the emulator jars are downloaded on first use into `~/.cache/firebase/emulators` (CI caches that directory).

- `firebase.json` (repo root) fixes the ports: Firestore `127.0.0.1:8081`, Auth `127.0.0.1:9099`; the Emulator UI is disabled. The project is `demo-certificate-manager` (the `demo-` prefix makes the CLI refuse any non-emulated service).
- `firebase emulators:exec` starts the emulators once, runs Vitest inside them (it exports `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `GCLOUD_PROJECT`) and stops them afterwards, so the startup cost is paid once per run, not per file.
- Test files run one after another (`fileParallelism: false`) and share one emulator. Each file isolates its data: call `resetFirestore()` in `beforeEach`, or use unique IDs (Auth users get a random e-mail).

Helpers (`test/integration/helpers/`, import from `./helpers/index.js`):

| Helper                  | Purpose                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `resetFirestore()`      | `DELETE` on the emulator's clear endpoint; removes every document.                                                |
| `getTestFirestore()`    | `firebase-admin` Firestore client bound to the emulator.                                                          |
| `createTestAdmin()`     | Creates an Auth emulator user with the `role=admin` custom claim, signs in and returns `{ uid, email, idToken }`. |
| `createTestUser()`      | Same without the claim (authenticated, not an administrator).                                                     |
| `buildIntegrationApp()` | `buildApp()` wired with ports; returns `{ app, ports, close() }`. Accepts overrides for single ports.             |

Current gaps (the code they depend on does not exist yet; each place carries a `TODO`):

- There is no Firestore adapter yet, so `buildIntegrationApp()` uses the in-memory fakes for every port and `test/integration/firestore.integration.test.ts` writes and reads through `firebase-admin` directly. When the adapter lands, wire it into `buildIntegrationApp()` and switch the sample test to the repository.
- `FirebaseTokenVerifier` (`src/adapters/firebase`) verifies emulator tokens in `firebase-token-verifier.integration.test.ts`; `auth.integration.test.ts` pins the structure of the emulator's tokens.

### Storage emulator (optional)

Storage adapter tests use [fake-gcs-server](https://github.com/fsouza/fake-gcs-server) (image pinned by digest, v1.56.1). They are skipped unless `STORAGE_EMULATOR_HOST` is set:

```bash
docker compose -f test/integration/docker-compose.storage.yml up -d
STORAGE_EMULATOR_HOST=localhost:4443 npm run test:integration
docker compose -f test/integration/docker-compose.storage.yml down
```

The GCS adapter is expected to read the same variable (the official `@google-cloud/storage` client does). CI does not run these tests; the Firestore/Auth job needs no Docker.

**Generation preconditions.** `StorageGateway.putIfAbsent` maps to `ifGenerationMatch=0`. Verified against fake-gcs-server 1.56.1 (`storage.integration.test.ts`): uploads honour `ifGenerationMatch` for the media, multipart and resumable protocols, the second write of a key with `ifGenerationMatch=0` fails with HTTP 412, a stale generation fails with 412, and of 20 concurrent writers exactly one succeeds. So the emulator covers the `putIfAbsent` contract and **no ADR is needed**. Known gap, not relied on by the port: `DELETE ... ?ifGenerationMatch=` is ignored by the emulator (the object is deleted regardless). `StorageGateway.delete` takes no precondition, so nothing is lost; if one is ever added, cover it with a manual check against a real bucket in the E2 verification story. The `copy` path (`rewriteTo`/`copyTo`) was not exercised and belongs to the adapter contract tests.

## Domain events

`InProcessEventBus` (`src/adapters/in-process/event-bus.ts`) implements the `EventBus` port. `publish` awaits subscribers one after another in registration order; a throwing or rejecting subscriber is logged at ERROR (event type, subscriber name, error message/stack, never the payload) and never reaches the publisher. Subscribers register in the composition root (`subscribe(type, name, handler)` returns an unsubscribe function), so publishers never change when one is added.

## OpenAPI

The API contract is generated from the zod schemas of the routes (`fastify-type-provider-zod` + `@fastify/swagger`, OpenAPI 3.1) and committed as `api/openapi.json`. Never edit that file by hand.

- Every route declares zod schemas for params, query, body and all documented responses. Use `errorResponses(...)` from `src/http/openapi/responses.ts` to document error statuses with the shared `ErrorBody` schema (429, 500 and 503 are always added); `jsonResponse(description, schema)` for success bodies.
- Response bodies are produced from the schema (unknown fields are dropped, a mismatch is a generic `500 INTERNAL`). DTO schemas for public responses live in `src/http/dto/public/` and are built field by field, never by spreading an entity. `test/unit/dto-guard.test.ts` fails if a public DTO or the generated document contains `email`, `pdfPath`, `createdBy` or `revokeReason`, or if DTO code spreads an object.
- After changing a route or DTO: `npm run openapi:generate -w api`, commit `api/openapi.json`, then `npm run api:types -w web` and commit the regenerated `web/src/api/schema.d.ts`. `test/unit/openapi.test.ts` boots the app and fails when the live spec differs from the committed file.
- `GET /internal/openapi.json` serves the live document. It is registered only when `FEATURE_OPENAPI_ENDPOINT` is on (default: on outside production, off in production).

### Breaking-change check (`openapi-check` CI job)

On pull requests the job compares `api/openapi.json` with the version on the base branch (`git show origin/dev:api/openapi.json`) using [oasdiff](https://github.com/oasdiff/oasdiff) (pinned release, SHA-256 verified). Removed or renamed paths and fields, narrowed types and new required request fields fail the job; additive changes pass. Within `/api/v1` changes must be additive: for an intentional breaking change add the PR label `breaking-api-v2` and re-run the job (the label is read live).

Verify locally (download the pinned `oasdiff_1.35.0_linux_amd64.tar.gz` from the oasdiff releases, or `brew install oasdiff`):

```bash
git fetch origin dev
OASDIFF=/path/to/oasdiff api/scripts/openapi-check.sh origin/dev   # exit 1 on breaking changes
```

While `dev` still contains the hand-written stub (`info.version` `0.0.0-stub`), the script skips the diff (bootstrap case, marked `BOOTSTRAP ONLY` in `api/scripts/openapi-check.sh`; delete that block afterwards).

## Module READMEs

Every directory under `src/modules/*` needs a non-empty `README.md` (responsibility, public interface, owned data, non-goals; template `docs/module-readme-template.md`). `npm run check:module-readmes` fails otherwise and runs in CI. Decisions are recorded in `docs/adr/`.

## Data migrations

One-off data changes (for example creating the bootstrap administrator) are numbered migrations in `src/migrations/`. `runMigrations()` runs from `src/server.ts` after the adapters are composed and before `listen`; if a migration fails the process logs the error and exits with code 1, so Cloud Run restarts the instance and the migration is retried.

- **Markers.** Which migrations ran is stored by the `MigrationStateStore` port (`src/ports/migration-state-store.ts`) in a single document, `system/migrations`, as `applied.<id> = { at, by }` (`by` is the Cloud Run revision plus a random suffix). The runner reads that document once; with nothing pending a cold start costs exactly one read.
- **At most once.** The runner claims a migration with `markApplied(id, by)` _before_ running its body. The claim is atomic (a Firestore transaction): of any number of parallel instances exactly one gets `true` and runs the body, the others get `false` and skip it. If the body throws, the runner calls `unmarkApplied` so the next start retries, and stops (later migrations do not run). The window to know about: an instance killed after the claim and before the body finished leaves a marker without a finished migration; remove `applied.<id>` from `system/migrations` and run the migration by hand (see below).
- **Idempotent bodies.** Write every migration so that running it twice is harmless (check before create, use deterministic ids). The marker write and the body are not one transaction.
- **Context.** A migration receives `MigrationContext`: `clock`, the repositories, `emailSender` and a logger. Ports only, no vendor SDK.
- **Adapters.** `FakeMigrationStateStore` (`src/testing/fakes`, served by the `memory` DB adapter) and `FirestoreMigrationStateStore` (`src/adapters/firestore`) share the contract suite `describeMigrationStateStoreContract`. The Firestore store is tested against the emulator (`test/integration/migrations.integration.test.ts`, including two concurrent runners). It is not registered in `compose.ts` yet because the Firestore repository adapter does not exist yet (the `firestore` value of `DB_ADAPTER` still fails at boot); that registration must provide `migrationState` next to the repositories.

### Adding migration 00N

1. Create `src/migrations/00N-short-name.ts` exporting a `Migration` (`id: '00N-short-name'`, `description`, idempotent `run(ctx)`).
2. Append it to `migrations` in `src/migrations/registry.ts`. Ids must be unique, `NNN-kebab-case` and in ascending order; the runner refuses an invalid list at boot. Never rename, reorder or delete a deployed migration.
3. Add a unit test with `FakeMigrationStateStore` (see `test/unit/migrations.test.ts`) that runs it twice.

### Running migrations manually

```bash
cd api
npm run migrate   # same environment variables as the server (DB_ADAPTER, GCP_PROJECT, FIRESTORE_EMULATOR_HOST, ...)
```

`src/migrate.ts` composes the ports like the server, runs the pending migrations, logs what it applied and exits (non-zero on failure). In the container image use `node dist/migrate.js`. Running it while instances start is safe: markers make each migration run once. Like `server.ts`, it is an entry point and reads `process.env`.

### `schemaVersion`

Every document a repository creates carries `schemaVersion: 1` (`SCHEMA_VERSION` in `src/shared/schema-version.ts`). Readers ignore fields they do not know: the adapter parses with zod (unknown keys tolerated) and the DTOs returned over HTTP strip them, so a new revision can add fields while the old one still serves traffic. Raise the version only for a change old readers cannot tolerate, together with a migration.
