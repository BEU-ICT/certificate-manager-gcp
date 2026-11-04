#!/usr/bin/env bash
# Create the GCP project, link billing, add Firebase, grant Owner to the human owners.
# Usage: DRY_RUN=1 ./01-project.sh   (review first)   |   ./01-project.sh
# Run 02-budget.sh immediately afterwards and BEFORE any other script: spec §12.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID BILLING_ACCOUNT_ID OWNER_EMAILS

if query gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  log "project ${PROJECT_ID} exists"
else
  run gcloud projects create "${PROJECT_ID}" --name="${PROJECT_NAME:-Certificate Manager}"
fi

run gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT_ID}"

# Firebase needs the project to be added once; the Blaze plan is chosen in the console
# (billing already linked above makes the project Blaze).
if query firebase projects:list 2>/dev/null | grep -q "${PROJECT_ID}"; then
  log "firebase already enabled on ${PROJECT_ID}"
else
  run firebase projects:addfirebase "${PROJECT_ID}"
fi

# At least two humans with Owner; add-iam-policy-binding is idempotent.
for email in ${OWNER_EMAILS}; do
  run gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="user:${email}" --role="roles/owner" --condition=None --quiet >/dev/null
done
log "done. NEXT: ./02-budget.sh before creating anything else"
