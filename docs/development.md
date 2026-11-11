# Local development

Developers work against the Firebase emulators and in-memory adapters; **production credentials are never used locally** (the emulator variables are set by the scripts, and the Firebase project id `demo-certificate-manager` has no cloud resources).

## Prerequisites

Node.js per `.nvmrc`, npm, Java 21 (Firestore and Auth emulators), Docker (container build and the optional storage emulator), `firebase-tools` (installed as a dev dependency; use `npx firebase`).

## First run

```bash
npm ci
cp api/.env.example api/.env      # safe local defaults (emulators / in-memory)
cp web/.env.example web/.env
npm run dev                        # emulators + API + Vite   (npm run dev:lite skips the emulators)
```

The SPA runs on `http://localhost:5173`, the API on `http://localhost:8080`, Firestore emulator on `127.0.0.1:8081`, Auth emulator on `127.0.0.1:9099`. The SPA signs in against the Auth emulator when `VITE_USE_AUTH_EMULATOR=true` is set in `web/.env`.

## Tests

```bash
npm run test:unit -w api
npm run test:integration -w api    # starts emulators, includes the Firestore rules test
npm run test:unit -w web           # Vitest + Testing Library
npm run test:e2e -w web            # Playwright smoke suite (starts API and Vite itself)
npx prettier --check . && npm run lint --workspaces --if-present
infra/test-dry-run.sh && infra/test-smoke.sh   # deployment scripts, offline
```

## Debugging and resetting data

Run the API with `LOG_LEVEL=debug`. Emulator data lives only in memory: stop and restart `npm run dev` to reset. The integration helpers expose `resetFirestore()` for tests.

## Safety rules

`api/.env` and `web/.env` are git-ignored. Never put real project ids or secrets into local env files.

## Seed data

With the emulators running (`npm run dev:emulators`, or `npm run dev`), fill them with demo data:

```bash
npm run seed:dev
```

It creates the administrator `admin@example.test` (password `local-admin-password`, valid only in the Auth emulator; override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`), one organization, one event, one template and three certificates (two active, one revoked, one without e-mail). It is idempotent and refuses to run unless `GCP_PROJECT` starts with `demo-` and both emulator hosts are local.

To see the data in the SPA, run the API against the Firestore emulator (`DB_ADAPTER=firestore` in `api/.env`, or leave it unset and export `FIRESTORE_EMULATOR_HOST=127.0.0.1:8081`), set `VITE_USE_AUTH_EMULATOR=true` in `web/.env` and sign in with the seeded administrator. Limitation: no persistent storage adapter exists yet (`STORAGE_ADAPTER=memory`), so the template document is seeded but its package files vanish when the script exits; previews and PDFs of the seeded template work once a storage adapter lands.

`npm run test:e2e:auth` starts the emulators, seeds and runs the Playwright suite including the sign-in tests (needs Java 21).
