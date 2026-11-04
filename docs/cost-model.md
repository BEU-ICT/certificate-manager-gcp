# Cost model

Checked on **2026-11-04**. Goal (spec §12, issue #16 §7): stay inside the free tiers, about $0 per month, and know exactly which usage would cost money. Limits can change with 30 days' notice, so repeat the check before go-live and every six months.

## Sources

- Google Cloud Free Tier (Cloud Run, Firestore, Cloud Storage, Cloud Build, Artifact Registry, Secret Manager, Logging, Monitoring): https://docs.cloud.google.com/free/docs/free-cloud-features
- Firebase pricing (Hosting, Authentication, Blaze no-cost quotas): https://firebase.google.com/pricing
- Detail pages (prices beyond the free tier): [Cloud Run](https://cloud.google.com/run/pricing), [Firestore](https://cloud.google.com/firestore/pricing), [Cloud Tasks](https://cloud.google.com/tasks/pricing), [Cloud Scheduler](https://cloud.google.com/scheduler/pricing), [Identity Platform](https://cloud.google.com/identity-platform/pricing)

Not machine-readable on the check date (the pricing pages returned only titles): the Cloud Tasks (1 million operations/month), Cloud Scheduler (3 jobs per billing account) and Identity Platform free amounts and every "price beyond" figure below. Those are marked **unverified**; a person must re-read them in the browser before go-live.

## Free limits that apply

| Service                                     | Free limit                                                                                                                                                         | Verified            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Cloud Run (request-based billing)           | 2 M requests, 360,000 GiB-s, 180,000 vCPU-s, 1 GB egress (North America) per month                                                                                 | yes                 |
| Firestore `(default)` database              | 1 GiB stored; 50,000 reads, 20,000 writes, 20,000 deletes per **day**; 10 GiB egress/month. Free quota applies to the `(default)` database only                    | yes                 |
| Cloud Storage                               | 5 GB-months regional storage in `us-east1`/`us-west1`/`us-central1` combined; 5,000 Class A and 50,000 Class B operations; 100 GB egress (North America) per month | yes                 |
| Firebase Hosting                            | 10 GB storage; 360 MB/day transfer                                                                                                                                 | yes                 |
| Firebase Authentication / Identity Platform | 50,000 monthly active users (email/password, Google); SMS billed (not used)                                                                                        | yes (Firebase page) |
| Secret Manager                              | 6 active secret versions, 10,000 access operations per month                                                                                                       | yes                 |
| Cloud Logging                               | first 50 GiB/month per project                                                                                                                                     | yes                 |
| Cloud Build                                 | 2,500 build-minutes/month (`e2-standard-2`)                                                                                                                        | yes                 |
| Artifact Registry                           | 0.5 GB storage                                                                                                                                                     | yes                 |
| Cloud Tasks                                 | 1 M operations/month                                                                                                                                               | **unverified**      |
| Cloud Scheduler                             | 3 jobs per billing account                                                                                                                                         | **unverified**      |

## Usage assumptions (per month)

A mid-size year: 5,000 certificates issued, 20,000 public detail views, 5,000 PDFs generated (first view of each, lazy per ADR 0007), 5,000 e-mails, 500 admin list page loads, 10 deployments. Average PDF 200 KB (cap 2 MB).

## Firestore reads per request

| Operation                                          | Reads                      | Monthly count | Reads/month                  |
| -------------------------------------------------- | -------------------------- | ------------- | ---------------------------- |
| Public details (`GET /public/certificates/{id}`)   | 1                          | 20,000        | 20,000                       |
| PDF generation (certificate + template + metadata) | 2-3                        | 5,000         | 15,000                       |
| Admin list page (limit <= 50)                      | <= 50                      | 500           | 25,000                       |
| Auth/role check, dashboard `count()` aggregations  | ~1 per 1,000 index entries | -             | < 2,000                      |
| **Total**                                          |                            |               | **~62,000, about 2,100/day** |

Quota is 50,000 reads/day, so average use is about 4 % of it. Worst day: a mailing sends a link to 5,000 recipients who all open it: 5,000 reads plus 3 x 5,000 for PDFs = 20,000, still below 50,000.

Writes: issuing a certificate is about 3 writes (certificate, uniqueness reservation, counters/e-mail status); 5,000 certificates = 15,000 writes/month. A single bulk issue of 5,000 on one day is 15,000 writes against the 20,000/day quota; 7,000+ in one day would exceed it, so bulk imports above 6,000 rows must be split across days.

## Result per service

| Service                                               | Expected                                                | Free limit                  | Verdict                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| Cloud Run requests                                    | ~60,000                                                 | 2,000,000                   | free                                                                              |
| Cloud Run vCPU-s (1 vCPU, ~4 s per PDF, ~0.2 s other) | ~32,000                                                 | 180,000                     | free                                                                              |
| Cloud Run GiB-s (512 MiB)                             | ~16,000                                                 | 360,000                     | free                                                                              |
| Firestore reads/day                                   | ~2,100 (peak ~20,000)                                   | 50,000                      | free                                                                              |
| Firestore writes/day                                  | ~500 (peak 15,000)                                      | 20,000                      | free                                                                              |
| Firestore storage                                     | < 50 MB                                                 | 1 GiB                       | free                                                                              |
| Storage PDFs (cumulative)                             | 1 GB added/month                                        | 5 GB-months                 | **free for about the first 5 months, then ~$0.02 per GB-month** (unverified rate) |
| Storage Class A operations                            | ~5,000 uploads + lists                                  | 5,000                       | **at the limit**; overage about $0.005 per 1,000 (unverified)                     |
| Storage egress (public PDFs)                          | ~4 GB                                                   | 100 GB                      | free                                                                              |
| Hosting transfer                                      | 150 KB gzipped JS x first loads, a few hundred MB/month | 360 MB/day                  | free (see below)                                                                  |
| Cloud Tasks                                           | 5,000                                                   | 1 M                         | free                                                                              |
| Cloud Scheduler                                       | 1 job (backups)                                         | 3 jobs                      | free                                                                              |
| Secret Manager                                        | <= 4 secrets, one version active each                   | 6 versions, 10,000 accesses | free (keep old versions disabled/destroyed)                                       |
| Artifact Registry                                     | one image about 250 MB                                  | 0.5 GB                      | free only if old images are deleted (cleanup policy keeping 1-2)                  |
| Cloud Build                                           | 10 x ~5 min                                             | 2,500 min                   | free                                                                              |
| Logging                                               | < 1 GiB                                                 | 50 GiB                      | free                                                                              |

**Conclusion:** the application stays at about $0 per month at this volume. The only items expected to cost money, and only cents, are PDF storage after about five months and Class A operations when more than about 5,000 PDFs are generated per month. The budget alerts ($1, $5) exist to catch anything else early.

## Hosting bundle size

Targets: public route <= 150 KB gzipped JS (issue #16 §7). 360 MB/day allows about 2,400 uncached first visits of that route per day; returning visitors hit the browser cache. The admin bundle is larger but used by a handful of people. Hosting storage (10 GB) is far above the SPA size (a few MB). Re-measure with the real build in the deployment story.

## If a quota is exceeded

1. A budget alert arrives (50/90/100 % of $1 and $5). Open Billing -> Reports, group by service.
2. Firestore reads/writes: Firestore returns `RESOURCE_EXHAUSTED` once the daily free quota is gone only if billing is off; on Blaze it bills about $0.06 per 100,000 reads and $0.18 per 100,000 writes (unverified), i.e. cents. Find the cause in the audit logs (a loop, a scraper) and fix it; rate limits (`RATE_LIMIT_PUBLIC_PER_MIN`) are the first defence.
3. Storage growth: add a lifecycle rule to move old PDFs to Nearline/Coldline or delete PDFs of revoked certificates (already required by ADR 0007); consider deleting PDFs older than N years since they are regenerated lazily.
4. Cloud Run: lower `--max-instances` (cost ceiling) and check for retry storms from Cloud Tasks.
5. Hosting: enable long cache headers for hashed assets (in `firebase.json`) and trim the bundle.
6. Last resort: unlink billing is destructive (services stop); prefer lowering instance caps and disabling the offending endpoint with a `FEATURE_*` flag.
