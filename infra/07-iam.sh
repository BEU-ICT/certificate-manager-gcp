#!/usr/bin/env bash
# Service accounts and the bindings that do not depend on resources created later.
#   project : datastore.user, firebaseauth.admin (runtime)
#   buckets : storage.objectAdmin on the two buckets only (runtime)
#   SAs     : serviceAccountUser on tasks-invoker, serviceAccountTokenCreator on itself (runtime)
# Bindings on the queue, the secret and the Cloud Run service are applied by 08-queue.sh,
# 09-secrets.sh and deploy-api.sh. All are verified by check-iam.sh. No keys are ever created.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

SA_DOMAIN="${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME="certificates-api-runtime@${SA_DOMAIN}"
TASKS_INVOKER="tasks-invoker@${SA_DOMAIN}"
TEMPLATES="${TEMPLATES_BUCKET:-${PROJECT_ID}-templates}"
PDFS="${PDF_BUCKET:-${PROJECT_ID}-pdfs}"

create_sa() { # create_sa NAME DISPLAY
  if query gcloud iam service-accounts describe "$1@${SA_DOMAIN}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    log "service account $1 exists"
  else
    run gcloud iam service-accounts create "$1" --display-name="$2" --project="${PROJECT_ID}"
  fi
}
create_sa certificates-api-runtime "Certificates API runtime (Cloud Run)"
create_sa tasks-invoker "Cloud Tasks OIDC identity"
create_sa scheduler-invoker "Cloud Scheduler OIDC identity"

for role in roles/datastore.user roles/firebaseauth.admin; do
  run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME}" --role="${role}" --condition=None --quiet >/dev/null
done
for bucket in "${TEMPLATES}" "${PDFS}"; do
  run gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
    --member="serviceAccount:${RUNTIME}" --role=roles/storage.objectAdmin >/dev/null
done
run gcloud iam service-accounts add-iam-policy-binding "${TASKS_INVOKER}" \
  --member="serviceAccount:${RUNTIME}" --role=roles/iam.serviceAccountUser --project="${PROJECT_ID}" >/dev/null
run gcloud iam service-accounts add-iam-policy-binding "${RUNTIME}" \
  --member="serviceAccount:${RUNTIME}" --role=roles/iam.serviceAccountTokenCreator --project="${PROJECT_ID}" >/dev/null
log "done. Remaining bindings come with 08-queue.sh, 09-secrets.sh, deploy-api.sh; then run check-iam.sh"
