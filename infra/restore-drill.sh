#!/usr/bin/env bash
# Restore drill: restore the newest backup into a TEMPORARY database, compare document counts
# of the main collections, delete the temporary database. Never touches (default).
# Usage: infra/restore-drill.sh            (prints the plan)   CONFIRM=yes infra/restore-drill.sh
# Needs at least one existing backup (wait a day after 06-backups.sh).
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

TMPDB="${DRILL_DATABASE:-restore-drill}"
[[ "${TMPDB}" != "(default)" ]] || die "refusing to use (default) as the drill database"
[[ "${CONFIRM:-}" == "yes" ]] || DRY_RUN=1
COLLECTIONS=(organizations events templates certificates admins uniques)

backup="$(query gcloud firestore backups list --location="${REGION}" --project="${PROJECT_ID}" \
  --sort-by=~snapshotTime --limit=1 --format='value(name)' || true)"
backup="${backup:-<newest-backup-name>}"
start=$SECONDS
run gcloud firestore databases restore --source-backup="${backup}" \
  --destination-database="${TMPDB}" --project="${PROJECT_ID}"

# Document counts: Firestore aggregation via the REST API (count is cheap: 1 read per 1,000 entries).
count() { # count DATABASE COLLECTION
  curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" \
      -H 'Content-Type: application/json' \
      "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/$1/documents:runAggregationQuery" \
      -d "{\"structuredAggregationQuery\":{\"structuredQuery\":{\"from\":[{\"collectionId\":\"$2\"}]},\"aggregations\":[{\"alias\":\"n\",\"count\":{}}]}}" \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["result"]["aggregateFields"]["n"]["integerValue"])'
}
if [[ "${DRY_RUN}" == "1" ]]; then
  log "dry run: would compare counts of ${COLLECTIONS[*]} between (default) and ${TMPDB}, then delete ${TMPDB}"
  exit 0
fi
bad=0
for c in "${COLLECTIONS[@]}"; do
  a="$(count '(default)' "${c}")"; b="$(count "${TMPDB}" "${c}")"
  log "${c}: live=${a} restored=${b}"
  # Documents written after the snapshot may make live > restored; restored > live is wrong.
  [[ "${b}" -le "${a}" ]] || bad=1
done
log "restore took $((SECONDS - start)) s (record in docs/backup-restore.md)"
run gcloud firestore databases delete --database="${TMPDB}" --project="${PROJECT_ID}" --quiet
[[ "${bad}" == "0" ]] || die "restored database has more documents than the live one; investigate"
