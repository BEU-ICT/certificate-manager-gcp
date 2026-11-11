# 0011 Manual deployment first

Status: accepted · Spec §2 · Issue BEU-ICT/certificate-manager#236 §10

## Context

There is one production GCP project, no staging project, and CI holds no cloud credentials. Automated deployment would need a trust setup that is not worth it before the first release.

## Decision

CI only builds and tests (including a Docker build that is never pushed). Deployment is performed by an operator with `gcloud run deploy --source .` from `api/` and the Firebase CLI for hosting, following the scripts and runbooks in `infra/` and `docs/`. Local development and tests use the Firebase emulators. Secrets live in Secret Manager.

## Consequences

- No cloud credentials in GitHub; a smaller attack surface.
- Releases depend on a documented, reproducible runbook and on a person.
- Continuous deployment can be added later without changing the application.
