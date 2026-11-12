#!/usr/bin/env bash
# Checks the security headers of a deployed API (BEU-ICT/certificate-manager#384).
# Usage: scripts/check-headers.sh https://example.web.app
set -euo pipefail

base="${1:?usage: check-headers.sh <base-url>}"
base="${base%/}"
fail=0

check() { # url expected-header-regex...
  local url="$1"; shift
  local headers
  headers="$(curl -sS -o /dev/null -D - --max-time 15 "$url" | tr -d '\r')"
  for expected in "$@"; do
    if ! grep -qiE "^${expected}" <<<"$headers"; then
      echo "FAIL $url: missing '${expected}'"; fail=1
    fi
  done
  for forbidden in 'x-powered-by:' 'access-control-allow-'; do
    if grep -qiE "^${forbidden}" <<<"$headers"; then
      echo "FAIL $url: unexpected '${forbidden}'"; fail=1
    fi
  done
  if grep -qiE '^server:.*(fastify|node|express)' <<<"$headers"; then
    echo "FAIL $url: server header reveals the stack"; fail=1
  fi
}

common=(
  "content-security-policy: default-src 'none'; frame-ancestors 'none'"
  'strict-transport-security: max-age=31536000; includeSubDomains'
  'x-content-type-options: nosniff'
  'referrer-policy: no-referrer'
  'cross-origin-resource-policy: same-origin'
  'x-frame-options: DENY'
  'permissions-policy:'
)

check "$base/api/v1/public/certificates/does-not-exist" "${common[@]}" 'cache-control: no-cache'
check "$base/api/v1/admin/me" "${common[@]}" 'cache-control: no-store'

status="$(curl -sS -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://evil.test' \
  -H 'Access-Control-Request-Method: GET' --max-time 15 "$base/api/v1/admin/me")"
if [ "$status" != "404" ]; then echo "FAIL preflight answered $status, expected 404"; fail=1; fi

if [ "$fail" -eq 0 ]; then echo "OK: security headers as expected for $base"; fi
exit "$fail"
