#!/usr/bin/env bash
# Fails when api/openapi.json contains breaking changes compared with the base branch version.
# Used by the `openapi-check` CI job and runnable locally (see "OpenAPI" in api/README.md).
#
#   OASDIFF=/path/to/oasdiff api/scripts/openapi-check.sh [base-ref]     # default base-ref: origin/dev
#
# Environment:
#   OASDIFF         oasdiff binary (default: oasdiff on PATH; CI pins v1.35.0 with a checksum)
#   ALLOW_BREAKING  "true" prints breaking changes but exits 0 (CI sets it for PRs labelled
#                   `breaking-api-v2`)
set -euo pipefail

base_ref="${1:-origin/dev}"
oasdiff_bin="${OASDIFF:-oasdiff}"
spec="api/openapi.json"
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

if ! git -C "${root}" show "${base_ref}:${spec}" >"${tmp}/base.json" 2>/dev/null; then
  echo "openapi-check: ${spec} does not exist on ${base_ref}; nothing to compare."
  exit 0
fi

# BOOTSTRAP ONLY (remove together with the stub once this has been on dev for one PR):
# the hand-written stub (E1-S4-T2, info.version 0.0.0-stub) documented a /health path that was
# never served, so replacing it with the generated document would always report a removed path.
# The stub has no consumers besides the web type generation, which is regenerated in the same PR.
if grep -Eq '"version"[[:space:]]*:[[:space:]]*"0\.0\.0-stub"' "${tmp}/base.json"; then
  echo "openapi-check: ${base_ref} still has the hand-written stub spec (0.0.0-stub); skipping the diff."
  exit 0
fi

echo "openapi-check: comparing ${base_ref}:${spec} (base) with the working tree (revision)"
"${oasdiff_bin}" changelog "${tmp}/base.json" "${root}/${spec}" || true

if "${oasdiff_bin}" breaking "${tmp}/base.json" "${root}/${spec}" --fail-on ERR; then
  echo "openapi-check: no breaking changes."
  exit 0
fi

if [ "${ALLOW_BREAKING:-false}" = "true" ]; then
  echo "openapi-check: breaking changes allowed (label breaking-api-v2)."
  exit 0
fi
echo "::error::Breaking API changes detected. Make the change additive, or label the PR 'breaking-api-v2' and re-run this job."
exit 1
