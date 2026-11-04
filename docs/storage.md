# Cloud Storage

Two buckets in `us-east1`, Standard class, uniform bucket-level access, created by `infra/05-buckets.sh` (`DRY_RUN=1` first). Names: `<project>-templates` and `<project>-pdfs`.

|                | `<project>-templates`                                         | `<project>-pdfs`                                                                                                                                       |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access         | private; public access prevention **enforced**; no public IAM | objects publicly readable via `roles/storage.legacyObjectReader` for `allUsers`; **never** `objectViewer` or `legacyBucketReader` (they allow listing) |
| Read/write by  | API runtime service account only                              | API writes; the public reads by name                                                                                                                   |
| CORS           | none                                                          | GET/HEAD from `PUBLIC_BASE_URL` and `http://localhost:5173`, header `Content-Type` (`infra/storage-cors.json`)                                         |
| Object headers | n/a                                                           | uploaded with `Cache-Control: no-cache` (no stale revoked PDFs)                                                                                        |

`PDF_PUBLIC_BASE_URL` is `https://storage.googleapis.com/<project>-pdfs` (no custom domain, no paid load balancer).

## Soft delete and cost

Soft delete is **disabled** (`--soft-delete-duration=0`) on both buckets. The default 7 days would keep deleted and replaced objects billed, and a revoked certificate's PDF must disappear immediately (ADR 0007). Trade-off: a deleted object cannot be restored from the bucket; PDFs are regenerated lazily from Firestore data and templates are versioned immutably (ADR 0008), so nothing irreplaceable depends on soft delete. Expected size: about 1 GB of PDFs per month at the cost model's volume; the free 5 GB-months last about five months (`docs/cost-model.md`). A lifecycle rule for old PDFs is a decision for that point.

`infra/storage.rules` denies all client access for the Firebase Storage rules engine; the API uses the Admin SDK and these buckets are not served through Firebase client SDKs.

## Verification

`infra/verify-iam.sh` (post-deploy checklist) uploads a test object and checks with unauthenticated requests: the object is readable and returns `Cache-Control: no-cache`; the PDF bucket cannot be listed; the templates bucket is not readable or listable; Firestore REST is denied; the bucket policy has exactly `legacyObjectReader` for `allUsers`; after deletion the object returns 404. Not yet run (needs the live project).
