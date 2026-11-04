#!/usr/bin/env bash
# Full release in the documented order: rules/indexes -> API -> web -> smoke test -> tag.
# Usage: infra/deploy-all.sh [--skip-checks]   (asks for confirmation once)
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID PUBLIC_BASE_URL
preflight_deploy "$@"
export ASSUME_YES=1   # confirmed above; sub-scripts must not prompt again
"${INFRA_DIR}/deploy-rules.sh" "$@"
"${INFRA_DIR}/deploy-api.sh" "$@"
"${INFRA_DIR}/deploy-web.sh" "$@"
if [[ "${DRY_RUN}" == "1" ]]; then
  log "dry run: smoke-test.sh ${PUBLIC_BASE_URL}; tag-release.sh"
  exit 0
fi
"${INFRA_DIR}/smoke-test.sh" "${PUBLIC_BASE_URL}" && "${INFRA_DIR}/tag-release.sh"
