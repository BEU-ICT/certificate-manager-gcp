# certificate-manager-gcp

Certificate management system on Google Cloud: Fastify API on Cloud Run, Firestore, Firebase Auth/Hosting and a React + Vite admin/public SPA.

Planning (epics, stories, tasks) lives in the private tracker [BEU-ICT/certificate-manager](https://github.com/BEU-ICT/certificate-manager/issues), not in this repository's issues. Shared decisions and the Definition of Done are in [BEU-ICT/certificate-manager#236](https://github.com/BEU-ICT/certificate-manager/issues/236). The source of requirements is the _Certificate Management System: GCP Technical Specification v1.0_.

## Layout

| Path       | Contents                                                         |
| ---------- | ---------------------------------------------------------------- |
| `api/`     | Node.js + TypeScript + Fastify backend (Cloud Run)               |
| `web/`     | React + Vite + TypeScript SPA (Firebase Hosting)                 |
| `infra/`   | gcloud/firebase scripts, Firebase config, Cloud Run service YAML |
| `scripts/` | Operational scripts (migrations, legacy import, verification)    |
| `docs/`    | ADRs (`docs/adr/`), runbooks, guides                             |

## Quick start

Prerequisites: Node.js from `.nvmrc` (`nvm use`) and a JDK 21+ for the Firebase emulators.

```bash
npm ci
npm run dev
```

`npm run dev` starts the Firebase Auth and Firestore emulators, the API and the web app together (Ctrl+C stops all three):

| What            | URL                                      |
| --------------- | ---------------------------------------- |
| Web app shell   | http://localhost:5173                    |
| API health      | http://localhost:8080/internal/healthz   |
| API via the web | http://localhost:5173/api/v1/... (proxy) |
| Emulators       | Firestore :8081, Auth :9099              |

Without a JDK use `npm run dev:lite` (API with in-memory adapters + web). The API needs no `.env` locally; see `api/README.md` and `web/README.md` for configuration and checks.

## Workflow

- Default branch: `dev`. Work branches: `feature/<issue-number>-<short-slug>`.
- Commit style: Conventional Commits.
- Every PR needs one approval and a description ending with `Closes BEU-ICT/certificate-manager#<n>` (the issue lives in the tracker repository).

## License

Proprietary. All rights reserved; see [LICENSE](LICENSE). No use of this code is permitted without the explicit permission of the copyright holder.
