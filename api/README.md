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
