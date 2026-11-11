# 0002 Modular monolith on Cloud Run

Status: accepted · Spec §2 · Issue BEU-ICT/certificate-manager#236 §1, §3

## Context

The system is small (a few administrators, a public verification page) and has a free-tier cost target. Separate services would add deployment, networking and latency cost without a scaling need.

## Decision

The backend (`api/`) is one Fastify service on Cloud Run in `us-east1`, organised in modules under `api/src/modules/*` (`organizations`, `events`, `templates`, `certificates`, `pdf`, `notifications`). Modules call each other only through the service interface exported from their `index.ts` or through domain events on the `EventBus`. Internal endpoints (`/internal/**`) are called by Cloud Tasks and Cloud Scheduler and are verified separately from user traffic.

## Consequences

- One image, one deploy, simple local run with in-memory adapters.
- Module isolation is a rule, not a process boundary, so it is enforced by tooling (ADR 0012) and each module documents its interface in its `README.md`.
- A module can be extracted into a service later because its public surface is already narrow (spec §13 "Evolution").
