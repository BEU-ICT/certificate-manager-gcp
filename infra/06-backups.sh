#!/usr/bin/env bash
# Daily managed Firestore backup, retained 7 days (RPO <= 24 h). Idempotent.
# Managed backups are stored by Firestore itself (not in a bucket), are not publicly accessible
# and are visible only to principals with datastore.backups.* (project owners; see docs/backup-restore.md).
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

existing=""
if existing="$(query gcloud firestore backups schedules list --database='(default)' \
  --project="${PROJECT_ID}" --format='value(name)')" && [[ -n "${existing}" ]]; then
  log "backup schedule exists: ${existing}"
else
  run gcloud firestore backups schedules create --database='(default)' \
    --recurrence=daily --retention=7d --project="${PROJECT_ID}"
fi
log "Verify: gcloud firestore backups schedules list --database='(default)' --project ${PROJECT_ID}"
