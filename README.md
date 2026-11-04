# certificate-manager-gcp

Certificate management system on Google Cloud: Fastify API on Cloud Run, Firestore, Firebase Auth/Hosting and a React + Vite admin/public SPA.

Planning (epics, stories, tasks) lives in [BEU-ICT/certificate-manager](https://github.com/BEU-ICT/certificate-manager/issues). Shared decisions and the Definition of Done are in [BEU-ICT/certificate-manager#23](https://github.com/BEU-ICT/certificate-manager/issues/23). The source of requirements is the _Certificate Management System: GCP Technical Specification v1.0_.

## Layout

| Path       | Contents                                                         |
| ---------- | ---------------------------------------------------------------- |
| `api/`     | Node.js + TypeScript + Fastify backend (Cloud Run)               |
| `web/`     | React + Vite + TypeScript SPA (Firebase Hosting)                 |
| `infra/`   | gcloud/firebase scripts, Firebase config, Cloud Run service YAML |
| `scripts/` | Operational scripts (migrations, legacy import, verification)    |
| `docs/`    | ADRs (`docs/adr/`), runbooks, guides                             |

## Quick start

_Placeholder: filled in once `api/` (BEU-ICT/certificate-manager#27) and `web/` exist._

```bash
nvm use
npm ci
```

## Workflow

- Default branch: `dev`. Work branches: `feature/<issue-number>-<short-slug>`.
- Commit style: Conventional Commits.
- Every PR needs one approval and a description with `Closes BEU-ICT/certificate-manager#<n>`.
