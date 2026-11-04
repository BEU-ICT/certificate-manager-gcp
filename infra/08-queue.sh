#!/usr/bin/env bash
# Cloud Tasks queue for emails (spec §9). Idempotent: creates the queue, or updates it when it exists.
#   max-attempts=5, backoff 10s..3600s with 4 doublings, 1 dispatch/s, 2 concurrent, no retry-duration cap.
# The adapter sets dispatchDeadline = 55 s per task (below the Cloud Run timeout of 60 s).
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

QUEUE="${TASKS_QUEUE:-email-queue}"
RUNTIME="certificates-api-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
FLAGS=(--location="${REGION}" --project="${PROJECT_ID}"
  --max-attempts=5 --min-backoff=10s --max-backoff=3600s --max-doublings=4
  --max-dispatches-per-second=1 --max-concurrent-dispatches=2 --max-retry-duration=0s)

if query gcloud tasks queues describe "${QUEUE}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  run gcloud tasks queues update "${QUEUE}" "${FLAGS[@]}"
else
  run gcloud tasks queues create "${QUEUE}" "${FLAGS[@]}"
fi

run gcloud tasks queues add-iam-policy-binding "${QUEUE}" --location="${REGION}" --project="${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME}" --role=roles/cloudtasks.enqueuer >/dev/null
log "Verify: gcloud tasks queues describe ${QUEUE} --location ${REGION} --project ${PROJECT_ID}"
