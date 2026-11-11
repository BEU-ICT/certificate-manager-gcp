# Backups and restore

Certificates are the system of record, so Firestore has a managed backup schedule: **daily, retained 7 days** (RPO <= 24 h), created by `infra/06-backups.sh`. Managed backups live inside Firestore (not in a bucket), are never public, and are only accessible to principals with the `datastore.backups.*` permissions, i.e. the project owners. No export bucket or Cloud Scheduler job is needed; if the cost check below fails, the fallback is `gcloud firestore export` to a `<project>-backups` bucket with a 14-day lifecycle rule, triggered by Cloud Scheduler with a minimal-role service account.

## Cost

Backup storage is billed per GiB-month for the retained snapshots (price: see [Firestore pricing](https://cloud.google.com/firestore/pricing), page not machine-readable on 2026-11-04, **unverified**). With a database under 50 MB and 7 daily snapshots the expected cost is below $0.01 per month; see the "Backups" row in `docs/cost-model.md`.

## Restore into a new database

A backup is never restored over `(default)`. Restore creates a new database:

```bash
gcloud firestore backups list --location=us-east1 --project "$PROJECT_ID"
gcloud firestore databases restore --source-backup=projects/$PROJECT_ID/locations/us-east1/backups/<id> \
  --destination-database=restore-YYYYMMDD --project "$PROJECT_ID"
```

To bring back selected collections, export them from the restored database and import into `(default)` (import merges by document id and overwrites same-id documents, so check the paths first):

```bash
gcloud firestore export gs://<project>-backups/restore-YYYYMMDD --database=restore-YYYYMMDD \
  --collection-ids=certificates --project "$PROJECT_ID"
gcloud firestore import gs://<project>-backups/restore-YYYYMMDD --database='(default)' \
  --collection-ids=certificates --project "$PROJECT_ID"
```

(That uses a temporary export bucket; delete it afterwards. Alternatively copy documents with a small Admin SDK script from `scripts/`.) Delete the temporary database when done: `gcloud firestore databases delete --database=restore-YYYYMMDD`. Remember that the restored database does not carry the TTL policies, indexes or rules of `(default)`; re-run `infra/04-firestore.sh`-style deployment only if it is promoted, which is not the plan.

## Drill

`infra/restore-drill.sh` (dry run by default, `CONFIRM=yes` to execute) restores the newest backup into the temporary database `restore-drill`, compares document counts of the main collections, prints the elapsed time and deletes the temporary database. It needs one existing backup, so run it the day after `06-backups.sh`.

| Date                   | Backup used | Restore time | Counts (live / restored) | Result |
| ---------------------- | ----------- | ------------ | ------------------------ | ------ |
| _pending live project_ |             |              |                          |        |

## Monitoring

Task BEU-ICT/certificate-manager#391 must add an alert "no successful backup within 36 h". Requirement recorded here; the metric to use is chosen there once a live project shows which backup metric/log entry exists.
