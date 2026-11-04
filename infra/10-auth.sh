#!/usr/bin/env bash
# Configure Firebase Auth / Identity Platform for administrators only (spec §10, ADR 0016):
#   - Email/Password only (no email link, anonymous, phone); user sign-up disabled
#   - authorized domains: the Hosting domains (+ localhost only with ALLOW_LOCALHOST=1)
#   - password policy (min 12, upper + lower + number), email-enumeration protection
# Uses the Identity Toolkit admin REST API with the operator's gcloud login. Idempotent (PATCH).
# NOT run by CI or by the offline agents; verify with infra/verify-auth-lockdown.sh afterwards.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

DOMAINS=("${PROJECT_ID}.web.app" "${PROJECT_ID}.firebaseapp.com")
[[ -n "${EXTRA_AUTH_DOMAIN:-}" ]] && DOMAINS+=("${EXTRA_AUTH_DOMAIN}")
[[ "${ALLOW_LOCALHOST:-0}" == "1" ]] && DOMAINS+=("localhost")
domains_json="$(printf '"%s",' "${DOMAINS[@]}")"
domains_json="[${domains_json%,}]"

body="$(
  cat <<JSON
{
  "signIn": {
    "email": { "enabled": true, "passwordRequired": true },
    "anonymous": { "enabled": false },
    "phoneNumber": { "enabled": false }
  },
  "client": { "permissions": { "disabledUserSignup": true, "disabledUserDeletion": true } },
  "authorizedDomains": ${domains_json},
  "emailPrivacyConfig": { "enableImprovedEmailPrivacy": true },
  "passwordPolicyConfig": {
    "passwordPolicyEnforcementState": "ENFORCE",
    "passwordPolicyVersions": [{
      "customStrengthOptions": {
        "minPasswordLength": 12,
        "containsLowercaseCharacter": true,
        "containsUppercaseCharacter": true,
        "containsNumericCharacter": true
      }
    }]
  }
}
JSON
)"
mask="signIn.email,signIn.anonymous,signIn.phoneNumber,client.permissions,authorizedDomains,emailPrivacyConfig,passwordPolicyConfig"
url="https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config?updateMask=${mask}"

if [[ "${DRY_RUN}" == "1" ]]; then
  run curl -sS -X PATCH "${url}" -H "Authorization: Bearer <gcloud access token>" \
    -H "X-Goog-User-Project: ${PROJECT_ID}" -H "Content-Type: application/json" -d "${body}"
  exit 0
fi

token="$(gcloud auth print-access-token)"
response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT
status="$(curl -sS -o "${response_file}" -w '%{http_code}' -X PATCH "${url}" \
  -H "Authorization: Bearer ${token}" -H "X-Goog-User-Project: ${PROJECT_ID}" \
  -H "Content-Type: application/json" -d "${body}")"
if [[ "${status}" != "200" ]]; then
  cat "${response_file}" >&2
  die "config update failed (HTTP ${status}); if it says Identity Platform is required, upgrade per docs/auth-config.md and rerun"
fi
log "auth configuration applied; run infra/verify-auth-lockdown.sh next"
