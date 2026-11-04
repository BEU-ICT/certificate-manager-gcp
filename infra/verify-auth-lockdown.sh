#!/usr/bin/env bash
# Proves that public sign-up is closed: Identity Toolkit `accounts:signUp` with the project's web API
# key and a random e-mail must fail (spec §10). Needs no login; creates no account when it passes.
#
#   FIREBASE_API_KEY=<web api key> PROJECT_ID=<id> infra/verify-auth-lockdown.sh
#
# Exit 0 when sign-up is rejected (ADMIN_ONLY_OPERATION or another 4xx error), 1 when it is possible.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env FIREBASE_API_KEY

email="lockdown-check-$(date +%s)-${RANDOM}@example.invalid"
url="https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}"

if [[ "${DRY_RUN}" == "1" ]]; then
  log "dry run: would POST accounts:signUp for a random e-mail and expect ADMIN_ONLY_OPERATION"
  exit 0
fi

response="$(curl -sS -o - -w '\n%{http_code}' -X POST "${url}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${email}\",\"password\":\"Aa1-${RANDOM}${RANDOM}${RANDOM}xYz\",\"returnSecureToken\":true}")"
status="${response##*$'\n'}"
body="${response%$'\n'*}"

if [[ "${status}" == "200" ]]; then
  log "FAIL  sign-up succeeded (HTTP 200): an account was created for ${email}; delete it and run infra/10-auth.sh"
  exit 1
fi
if grep -q 'ADMIN_ONLY_OPERATION' <<<"${body}"; then
  log "PASS  sign-up rejected with ADMIN_ONLY_OPERATION"
  exit 0
fi
if [[ "${status}" =~ ^4 ]]; then
  log "PASS  sign-up rejected (HTTP ${status}); reason differs from ADMIN_ONLY_OPERATION, check manually:"
  log "      $(tr -d '\n' <<<"${body}" | cut -c1-200)"
  exit 0
fi
log "FAIL  unexpected response (HTTP ${status})"
exit 1
