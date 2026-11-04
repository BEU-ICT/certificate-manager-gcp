#!/usr/bin/env bash
# Smoke test of a deployment. Exits non-zero on the first failing check.
# Usage: infra/smoke-test.sh <hosting-base-url> [<cloud-run-url>]
#   SMOKE_CERT_ID : id of a known certificate (optional; skips the public-details check when unset)
# Checks: /internal/healthz on Cloud Run, SPA index via Hosting, public details 200 without `email`,
# unknown id 404 JSON, admin/me without token 401, /internal not reachable through Hosting.
set -euo pipefail
BASE="${1:?usage: smoke-test.sh <hosting-base-url> [<cloud-run-url>]}"
BASE="${BASE%/}"
RUN_URL="${2:-${SERVICE_URL:-}}"
FAILS=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" || echo 000; }
expect() { # expect DESC ACTUAL EXPECTED
  if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (got $2, expected $3)"; fi
}

if [[ -n "${RUN_URL}" ]]; then
  expect "Cloud Run /internal/healthz" "$(status "${RUN_URL%/}/internal/healthz")" 200
else
  fail "Cloud Run URL not given (second argument or SERVICE_URL)"
fi

index="$(curl -s --max-time 20 "${BASE}/" || true)"
if grep -qi '<div id="root"' <<<"${index}"; then pass "SPA index via Hosting"; else fail "SPA index via Hosting"; fi

if [[ -n "${SMOKE_CERT_ID:-}" ]]; then
  body="$(curl -s --max-time 20 -w '\n%{http_code}' "${BASE}/api/v1/public/certificates/${SMOKE_CERT_ID}" || true)"
  code="${body##*$'\n'}"; json="${body%$'\n'*}"
  expect "public details 200" "${code}" 200
  if python3 -c 'import json,sys; sys.exit(1 if "email" in json.loads(sys.stdin.read()) else 0)' <<<"${json}" 2>/dev/null; then
    pass "public details contain no email"
  else
    fail "public details contain email (or invalid JSON)"
  fi
fi

nf="$(curl -s --max-time 20 -w '\n%{http_code}' "${BASE}/api/v1/public/certificates/does-not-exist" || true)"
expect "unknown id 404" "${nf##*$'\n'}" 404
python3 -c 'import json,sys; json.loads(sys.stdin.read())["error"]["code"]' <<<"${nf%$'\n'*}" 2>/dev/null \
  && pass "404 body is the JSON error shape" || fail "404 body is not the JSON error shape"

expect "admin/me without token 401" "$(status "${BASE}/api/v1/admin/me")" 401
# /internal must not be served by the API through Hosting (SPA fallback returns 200 HTML, never the API's JSON).
hi="$(curl -s --max-time 20 "${BASE}/internal/healthz" || true)"
if grep -qi '"status"' <<<"${hi}"; then fail "/internal/healthz reachable through Hosting"; else pass "/internal not exposed through Hosting"; fi

if [[ "${FAILS}" -gt 0 ]]; then
  echo "${FAILS} check(s) failed" >&2
  exit 1
fi
echo "all smoke checks passed"
