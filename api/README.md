# api

Node.js + TypeScript + Fastify backend, deployed to Cloud Run. See BEU-ICT/certificate-manager#27.

## Configuration

All configuration comes from environment variables, validated once at boot by `loadConfig(env)` in `src/config.ts` (zod). Copy `.env.example` to `.env` for local development; it lists every variable with a comment. If validation fails, the process prints every violation (variable name and reason, never a value) to stderr and exits with code 1 before listening.

- Outside `NODE_ENV=production`, unset variables fall back to local defaults (in-memory adapters, emulator project). In production the project, URLs, e-mail sender and adapter selectors are required, URLs must be `https`, and `memory`/`in-process` adapters are rejected.
- Only `src/server.ts` reads `process.env`; everything else receives the frozen `Config` object.

Feature flags (`FEATURE_*`, values `true|false|1|0`; unknown `FEATURE_*` variables fail boot): `FEATURE_OPENAPI_ENDPOINT` (default off in production, on elsewhere), `FEATURE_BOUNCE_JOB` (off), `FEATURE_EMAIL_FALLBACK` (on), `FEATURE_BULK_ISSUANCE` (on), `FEATURE_PUBLIC_PDF_GENERATION` (on). They are exposed as the typed `config.flags` object.
