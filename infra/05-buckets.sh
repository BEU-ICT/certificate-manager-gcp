#!/usr/bin/env bash
# Create the private templates bucket and the public PDF bucket (spec §3/§10/§12). Idempotent.
#   <project>-templates : private, public access prevention enforced, no public IAM
#   <project>-pdfs      : objects readable by allUsers (roles/storage.legacyObjectReader), NOT listable
# Both: us-east1, Standard, uniform bucket-level access, soft delete DISABLED.
# Soft delete is disabled so a revoked certificate's PDF is gone immediately (ADR 0007) and the
# free 5 GB-months are not consumed by deleted objects. Trade-off: deletes are not recoverable.
# Needs PUBLIC_BASE_URL (CORS origin), e.g. https://<project>.web.app
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID PUBLIC_BASE_URL

TEMPLATES="${TEMPLATES_BUCKET:-${PROJECT_ID}-templates}"
PDFS="${PDF_BUCKET:-${PROJECT_ID}-pdfs}"

create_bucket() {
  local name="$1"
  if query gcloud storage buckets describe "gs://${name}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    log "bucket ${name} exists"
  else
    run gcloud storage buckets create "gs://${name}" --project="${PROJECT_ID}" \
      --location="${REGION}" --default-storage-class=STANDARD \
      --uniform-bucket-level-access --soft-delete-duration=0
  fi
}

create_bucket "${TEMPLATES}"
run gcloud storage buckets update "gs://${TEMPLATES}" --public-access-prevention --soft-delete-duration=0

create_bucket "${PDFS}"
# The public bucket must not enforce prevention (see docs/org-policies.md for an org-level block).
run gcloud storage buckets update "gs://${PDFS}" --no-public-access-prevention --soft-delete-duration=0

# legacyObjectReader = read objects by name, no listing. Never objectViewer (it lists).
run gcloud storage buckets add-iam-policy-binding "gs://${PDFS}" \
  --member=allUsers --role=roles/storage.legacyObjectReader

# CORS (GET/HEAD from the public site and the Vite dev server).
cors_tmp="$(mktemp)"
trap 'rm -f "${cors_tmp}"' EXIT
sed "s#PUBLIC_BASE_URL_PLACEHOLDER#${PUBLIC_BASE_URL}#" "${INFRA_DIR}/storage-cors.json" >"${cors_tmp}"
run gcloud storage buckets update "gs://${PDFS}" --cors-file="${cors_tmp}"

log "PDF_PUBLIC_BASE_URL=https://storage.googleapis.com/${PDFS}  TEMPLATES_BUCKET=${TEMPLATES}  PDF_BUCKET=${PDFS}"
log "NEXT: run infra/verify-iam.sh"
