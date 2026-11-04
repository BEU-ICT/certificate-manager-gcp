#!/usr/bin/env bash
# Deploy Firestore rules and indexes. Usage: infra/deploy-rules.sh [--skip-checks]
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID
preflight_deploy "$@"
run firebase deploy --only firestore:rules,firestore:indexes --project "${PROJECT_ID}" \
  --config "${INFRA_DIR}/../firebase.json"
