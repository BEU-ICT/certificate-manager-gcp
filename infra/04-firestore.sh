#!/usr/bin/env bash
# Create the (default) Firestore database (Native mode, us-east1) and deploy rules + indexes (+ TTL).
# The database location cannot be changed later: review the DRY_RUN output first.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

if query gcloud firestore databases describe --database='(default)' --project="${PROJECT_ID}" >/dev/null 2>&1; then
  loc="$(gcloud firestore databases describe --database='(default)' --project="${PROJECT_ID}" --format='value(locationId)')"
  [[ "${loc}" == "${REGION}" ]] || die "(default) database is in ${loc}, expected ${REGION}"
  log "(default) database exists in ${loc}"
else
  run gcloud firestore databases create --database='(default)' --location="${REGION}" \
    --type=firestore-native --project="${PROJECT_ID}"
fi

run firebase deploy --only firestore:rules,firestore:indexes --project "${PROJECT_ID}" \
  --config "${INFRA_DIR}/../firebase.json"

log "Check: gcloud firestore indexes composite list --project ${PROJECT_ID} (all READY);"
log "       gcloud firestore fields ttls list --project ${PROJECT_ID} (idempotency, email_counters: expiresAt)"
