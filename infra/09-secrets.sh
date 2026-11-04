#!/usr/bin/env bash
# Secret Manager: EMAIL_API_KEY (Brevo key) with user-managed replication in us-east1, readable only by
# the runtime service account. A PLACEHOLDER version is added until the real key exists;
# the real value is added by an operator with `add-version` below, never via this repo or a file.
# Gmail uses keyless domain-wide delegation, so no secret is needed for it (a GMAIL_SA_KEY fallback
# needs an ADR first).
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

SECRET=EMAIL_API_KEY
RUNTIME="certificates-api-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

if query gcloud secrets describe "${SECRET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  log "secret ${SECRET} exists"
else
  run gcloud secrets create "${SECRET}" --project="${PROJECT_ID}" \
    --replication-policy=user-managed --locations="${REGION}"
  # Placeholder so the Cloud Run revision can start; replace before enabling Brevo.
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "dry run: would add placeholder version via stdin"
  else
    printf 'placeholder-replace-me' | gcloud secrets versions add "${SECRET}" --project="${PROJECT_ID}" --data-file=-
  fi
fi

run gcloud secrets add-iam-policy-binding "${SECRET}" --project="${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME}" --role=roles/secretmanager.secretAccessor >/dev/null

cat >&2 <<'MSG'
Rotation (see docs/config-matrix.md):
  1. read -rs KEY; printf %s "$KEY" | gcloud secrets versions add EMAIL_API_KEY --data-file=-
  2. deploy a new Cloud Run revision (infra/deploy-api.sh); the service mounts `latest`
  3. gcloud secrets versions disable <old-version> --secret EMAIL_API_KEY
Keep at most 6 active versions (free tier).
MSG
