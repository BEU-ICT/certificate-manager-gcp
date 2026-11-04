#!/usr/bin/env bash
# Enable the APIs of spec §3 / §12. Enabling an API is free; idempotent.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

APIS=(
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
  firestore.googleapis.com storage.googleapis.com cloudtasks.googleapis.com
  secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com
  identitytoolkit.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com
  gmail.googleapis.com cloudscheduler.googleapis.com logging.googleapis.com
  monitoring.googleapis.com cloudresourcemanager.googleapis.com
)

# Budget must exist before anything else is enabled (spec §12).
if [[ "${DRY_RUN}" != "1" && "${SKIP_BUDGET_CHECK:-0}" != "1" ]]; then
  [[ -n "$(gcloud billing budgets list --billing-account="${BILLING_ACCOUNT_ID:?}" \
    --filter="displayName~cert-manager-" --format='value(name)')" ]] \
    || die "no budget found; run 02-budget.sh first"
fi

run gcloud services enable "${APIS[@]}" --project="${PROJECT_ID}"

# Verification (acceptance: output contains every listed API)
if [[ "${DRY_RUN}" != "1" ]]; then
  enabled="$(gcloud services list --enabled --project="${PROJECT_ID}" --format='value(config.name)')"
  for api in "${APIS[@]}"; do
    grep -qx "${api}" <<<"${enabled}" || die "${api} not enabled"
  done
  log "all ${#APIS[@]} APIs enabled"
fi
