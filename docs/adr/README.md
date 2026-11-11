# Architecture Decision Records

One Markdown file per decision, numbered `NNNN-title.md`, in the Michael Nygard format: Title, Status, Context, Decision, Consequences. Copy [`0000-template.md`](0000-template.md) to start a new one, keep it to one page and link the relevant spec section ("the spec" is _Certificate Management System: GCP Technical Specification v1.0_; cross-cutting conventions and spec corrections are in issue BEU-ICT/certificate-manager#236). An accepted ADR is not edited to change the decision: add a new ADR and mark the old one superseded.

| ADR                                                   | Decision                                                                  | Status   |
| ----------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| [0001](0001-ports-and-adapters.md)                    | Ports and adapters: vendor SDKs only under `src/adapters/**`              | accepted |
| [0002](0002-modular-monolith-on-cloud-run.md)         | Modular monolith on Cloud Run                                             | accepted |
| [0003](0003-firestore-repository-pattern.md)          | Firestore behind repository ports                                         | accepted |
| [0004](0004-admin-only-firebase-auth.md)              | Firebase Auth, administrators only, `role=admin` claim                    | accepted |
| [0005](0005-two-storage-buckets.md)                   | Two buckets: private templates, public PDFs                               | accepted |
| [0006](0006-spa-on-firebase-hosting.md)               | React SPA on Firebase Hosting with `/api/v1` rewrite                      | accepted |
| [0007](0007-lazy-pdf-generation.md)                   | Lazy PDF generation, caching, deletion on revocation                      | accepted |
| [0008](0008-immutable-template-versions.md)           | Immutable template versions and the template reference scheme             | accepted |
| [0009](0009-email-sender-port.md)                     | E-mail through `EmailSender` (Gmail, Brevo fallback, Cloud Tasks)         | accepted |
| [0010](0010-soft-deletion-by-revocation.md)           | Soft deletion by `status=revoked`                                         | accepted |
| [0011](0011-manual-deployment-first.md)               | Manual deployment first                                                   | accepted |
| [0012](0012-hexagonal-boundary-enforcement.md)        | Hexagonal boundaries and how they are enforced                            | accepted |
| [0013](0013-spec-corrections.md)                      | Corrections to the spec recorded in issue BEU-ICT/certificate-manager#236 | accepted |
| [0014](0014-token-revocation-check-off-by-default.md) | Token revocation check is off by default                                  | accepted |
| [0016](0016-identity-platform-for-signup-lockdown.md) | Disable sign-up through the Identity Platform configuration               | proposed |
