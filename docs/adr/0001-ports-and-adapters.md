# 0001 Ports and adapters

Status: accepted · Task: BEU-ICT/certificate-manager#32 · Spec §5, §5.1

Domain and application code depends only on the interfaces in `api/src/ports/`. Vendor SDKs live under `api/src/adapters/**`; adapters are selected by configuration. Port files import only other ports and `src/shared`. Ports are named after the capability, never after a vendor.

| Port                                                                                       | Purpose                                                                | GCP adapter (v1)       | Later / on-prem adapter      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------- | ---------------------------- |
| `OrganizationRepository`, `EventRepository`, `TemplateRepository`, `CertificateRepository` | Persistence of entities                                                | Firestore              | PostgreSQL                   |
| `StorageGateway`                                                                           | Template and PDF objects (`templates`, `pdfs`)                         | Cloud Storage          | S3-compatible / filesystem   |
| `TaskQueue`                                                                                | Deferred at-least-once handler execution, named de-duplication         | Cloud Tasks            | BullMQ, in-process           |
| `Scheduler`                                                                                | Registry of recurring jobs                                             | Cloud Scheduler        | cron                         |
| `EmailSender`                                                                              | Outbound mail with typed errors                                        | Gmail API (DWD), Brevo | SMTP                         |
| `TokenVerifier`                                                                            | Verify administrator bearer tokens                                     | Firebase Auth          | generic OIDC                 |
| `TaskRequestVerifier`                                                                      | Verify calls to `/internal/**`                                         | Google OIDC            | shared secret / OIDC         |
| `EventBus`                                                                                 | In-process domain events (`certificate.issued`, `certificate.revoked`) | in-process             | Pub/Sub, broker              |
| `RateLimiter`                                                                              | Fixed-window request limits                                            | Firestore counters     | Redis                        |
| `Clock`, `IdGenerator`                                                                     | Time and ID generation                                                 | system                 | deterministic fakes in tests |

Shared types: `Page<T>`, `Cursor`, `Filter` (`src/ports/common.ts`) and branded IDs `CertificateId`, `OrganizationId`, `EventId`, `TemplateRef` with validators (`src/shared/ids.ts`).

Changing a port requires updating its fake and its contract tests.
