# 0014 Region us-east1 and data residency

Status: proposed (stakeholder confirmation pending) · Spec §3, §12, §14 · Issue/PR: #47

## Context

All resources live in one production project (ADR 0011). The Firestore always-free quota applies only to the `(default)` database, and Cloud Storage Always Free covers 5 GB-months of Standard storage only in `us-east1`, `us-west1` and `us-central1`. Spec §14 asks stakeholders to confirm that a United States region is acceptable for certificate data (owner names, subjects, optional emails).

## Decision

We will place every regional resource (Firestore `(default)` in Native mode, both buckets, Cloud Run, Cloud Tasks, Cloud Scheduler) in `us-east1`. Secret Manager and Firebase Hosting are global. Project, billing, budgets and owners are set up by `infra/01-project.sh` and `infra/02-budget.sh` before anything else.

Residency confirmation (to be filled in before go-live):

| Confirmed by | Role | Date | Channel |
| ------------ | ---- | ---- | ------- |
| _pending_    |      |      |         |

## Consequences

- Staying inside the free tiers needs this region; moving later means a Firestore export/import and new buckets.
- Latency from Azerbaijan is higher than from a European region; the public page is cacheable and light, so this is accepted.
- Go-live is blocked until the table above is completed. If stakeholders refuse, this ADR is superseded and the cost model (`docs/cost-model.md`) is re-evaluated for the new region.
