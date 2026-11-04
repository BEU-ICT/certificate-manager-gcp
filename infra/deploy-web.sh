#!/usr/bin/env bash
# Build the SPA and deploy it to Firebase Hosting. Usage: infra/deploy-web.sh [--skip-checks]
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID
preflight_deploy "$@"
ROOT="${INFRA_DIR}/.."
if [[ "${DRY_RUN}" == "1" ]]; then
  log "dry run: npm ci && npm run build -w web"
else
  (cd "${ROOT}" && npm ci && npm run build -w web)
fi
run firebase deploy --only hosting --project "${PROJECT_ID}" --config "${ROOT}/firebase.json"
