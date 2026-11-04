#!/usr/bin/env bash
# Read-only: diff the actual IAM bindings of the application service accounts against
# infra/iam-expected.txt. Also fails if any service account holds owner/editor.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

QUEUE="${TASKS_QUEUE:-email-queue}"
SERVICE="${CLOUD_RUN_SERVICE:-certificates-api}"
TEMPLATES="${TEMPLATES_BUCKET:-${PROJECT_ID}-templates}"
PDFS="${PDF_BUCKET:-${PROJECT_ID}-pdfs}"
SA_DOMAIN="${PROJECT_ID}.iam.gserviceaccount.com"

if [[ "${DRY_RUN}" == "1" ]]; then
  log "dry run: would read project, bucket, queue, secret, service and service-account policies"
  exit 0
fi

# Members we care about: our three service accounts and the public principal.
RELEVANT="serviceAccount:(certificates-api-runtime|tasks-invoker|scheduler-invoker)@${SA_DOMAIN}|allUsers|allAuthenticatedUsers"
rows() { # rows SCOPE RESOURCE <gcloud get-iam-policy command...>
  local scope="$1" res="$2"; shift 2
  "$@" --flatten='bindings[].members' --format='value(bindings.role,bindings.members)' \
    | awk -v s="${scope}" -v r="${res}" '{print s, r, $1, $2}' | grep -E " (${RELEVANT})$" || true
}

actual="$(
  rows project "${PROJECT_ID}" gcloud projects get-iam-policy "${PROJECT_ID}"
  rows bucket "${TEMPLATES}" gcloud storage buckets get-iam-policy "gs://${TEMPLATES}" --project="${PROJECT_ID}"
  rows bucket "${PDFS}" gcloud storage buckets get-iam-policy "gs://${PDFS}" --project="${PROJECT_ID}"
  rows queue "${QUEUE}" gcloud tasks queues get-iam-policy "${QUEUE}" --location="${REGION}" --project="${PROJECT_ID}"
  rows secret EMAIL_API_KEY gcloud secrets get-iam-policy EMAIL_API_KEY --project="${PROJECT_ID}"
  for sa in tasks-invoker certificates-api-runtime scheduler-invoker; do
    rows sa "${sa}@${SA_DOMAIN}" gcloud iam service-accounts get-iam-policy "${sa}@${SA_DOMAIN}" --project="${PROJECT_ID}"
  done
  rows run "${SERVICE}" gcloud run services get-iam-policy "${SERVICE}" --region="${REGION}" --project="${PROJECT_ID}"
)"
expected="$(grep -v '^#' "${INFRA_DIR}/iam-expected.txt" | sed "s/\${P}/${PROJECT_ID}/g")"

if diff <(sort <<<"${expected}") <(sort <<<"${actual}"); then
  log "IAM matches infra/iam-expected.txt"
else
  die "IAM differs from infra/iam-expected.txt (< expected, > actual)"
fi
if grep -Eq " roles/(owner|editor) serviceAccount:" <<<"${actual}"; then
  die "an application service account holds owner/editor"
fi
