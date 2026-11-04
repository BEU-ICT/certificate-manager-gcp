#!/usr/bin/env bash
# Post-deploy IAM/exposure check with UNAUTHENTICATED requests (spec §10, E2 acceptance):
#   a) a PDF object is publicly readable (200) and served with Cache-Control: no-cache
#   b) the PDF bucket cannot be listed (401/403)
#   c) the templates bucket is not readable (401/403)
#   d) a deleted PDF is no longer served (404)
#   e) Firestore REST is denied to unauthenticated clients (403)
#   f) the PDF bucket IAM policy has only legacyObjectReader for allUsers
# Creates and removes one test object in the PDF bucket (needs the operator's gcloud login).
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

TEMPLATES="${TEMPLATES_BUCKET:-${PROJECT_ID}-templates}"
PDFS="${PDF_BUCKET:-${PROJECT_ID}-pdfs}"
OBJECT="verify-iam-$(date +%s).txt"
FAILS=0

http_status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check() { # check DESCRIPTION ACTUAL EXPECTED_REGEX
  if [[ "$2" =~ ^($3)$ ]]; then
    log "PASS  $1 ($2)"
  else
    log "FAIL  $1 (got $2, expected $3)"
    FAILS=$((FAILS + 1))
  fi
}

if [[ "${DRY_RUN}" == "1" ]]; then
  log "dry run: would upload gs://${PDFS}/${OBJECT}, curl the checks above, delete it"
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT
echo "verify-iam ${OBJECT}" >"${tmp}"
gcloud storage cp "${tmp}" "gs://${PDFS}/${OBJECT}" --cache-control="no-cache" \
  --content-type=text/plain --project="${PROJECT_ID}" >/dev/null

url="https://storage.googleapis.com/${PDFS}/${OBJECT}"
check "a) public object readable" "$(http_status "${url}")" 200
cc="$(curl -sI "${url}" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}')"
check "a) Cache-Control header" "${cc}" "no-cache"
check "b) PDF bucket listing denied" \
  "$(http_status "https://storage.googleapis.com/storage/v1/b/${PDFS}/o")" "401|403"
check "c) templates bucket read denied" \
  "$(http_status "https://storage.googleapis.com/${TEMPLATES}/anything.svg")" "401|403"
check "c) templates bucket listing denied" \
  "$(http_status "https://storage.googleapis.com/storage/v1/b/${TEMPLATES}/o")" "401|403"
check "e) Firestore unauthenticated read denied" \
  "$(http_status "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/certificates")" "401|403"

policy="$(gcloud storage buckets get-iam-policy "gs://${PDFS}" --project="${PROJECT_ID}" --format=json)"
public_roles="$(python3 -c '
import json,sys
p=json.load(sys.stdin)
print(",".join(sorted(b["role"] for b in p.get("bindings",[]) if "allUsers" in b["members"] or "allAuthenticatedUsers" in b["members"])))' <<<"${policy}")"
check "f) public roles on PDF bucket" "${public_roles}" "roles/storage.legacyObjectReader"

gcloud storage rm "gs://${PDFS}/${OBJECT}" --project="${PROJECT_ID}" >/dev/null
check "d) deleted object not served" "$(http_status "${url}")" 404

if [[ "${FAILS}" -gt 0 ]]; then die "${FAILS} check(s) failed"; fi
log "all checks passed"
