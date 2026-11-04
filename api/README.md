# api

Node.js + TypeScript + Fastify backend, deployed to Cloud Run. See BEU-ICT/certificate-manager#27.

## Configuration

All configuration comes from environment variables, validated once at boot by `loadConfig(env)` in `src/config.ts` (zod). Copy `.env.example` to `.env` for local development; it lists every variable with a comment. If validation fails, the process prints every violation (variable name and reason, never a value) to stderr and exits with code 1 before listening.

- Outside `NODE_ENV=production`, unset variables fall back to local defaults (in-memory adapters, emulator project). In production the project, URLs, e-mail sender and adapter selectors are required, URLs must be `https`, and `memory`/`in-process` adapters are rejected.
- Only `src/server.ts` reads `process.env`; everything else receives the frozen `Config` object.

Feature flags (`FEATURE_*`, values `true|false|1|0`; unknown `FEATURE_*` variables fail boot): `FEATURE_OPENAPI_ENDPOINT` (default off in production, on elsewhere), `FEATURE_BOUNCE_JOB` (off), `FEATURE_EMAIL_FALLBACK` (on), `FEATURE_BULK_ISSUANCE` (on), `FEATURE_PUBLIC_PDF_GENERATION` (on). They are exposed as the typed `config.flags` object.

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

## Domain events

`InProcessEventBus` (`src/adapters/in-process/event-bus.ts`) implements the `EventBus` port. `publish` awaits subscribers one after another in registration order; a throwing or rejecting subscriber is logged at ERROR (event type, subscriber name, error message/stack, never the payload) and never reaches the publisher. Subscribers register in the composition root (`subscribe(type, name, handler)` returns an unsubscribe function), so publishers never change when one is added.
