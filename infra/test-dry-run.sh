#!/usr/bin/env bash
# Offline self-test: every numbered script must complete under DRY_RUN=1 and print gcloud commands only.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export DRY_RUN=1 PROJECT_ID=test-project BILLING_ACCOUNT_ID=000000-000000-000000 PUBLIC_BASE_URL=https://test-project.web.app BOOTSTRAP_ADMIN_EMAIL=a@example.com EMAIL_FROM_ADDRESS=c@example.com
export BUDGET_EMAILS="a@example.com b@example.com" OWNER_EMAILS="a@example.com b@example.com"
for s in [0-9][0-9]-*.sh check-*.sh verify-iam.sh restore-drill.sh; do
  [[ -f "$s" ]] || continue
  out="$(bash "$s" 2>&1)" || { echo "FAIL $s"; echo "$out"; exit 1; }
  echo "ok   $s"
done

# Cloud Run limits must be identical in the YAML and in the deploy script (spec §3).
for pair in "minScale: '0'|--min-instances 0" "maxScale: '3'|--max-instances 3" \
  "containerConcurrency: 80|--concurrency 80" "timeoutSeconds: 60|--timeout 60" \
  "memory: 512Mi|--memory 512Mi" "cpu-throttling: 'true'|--cpu-throttling" "startup-cpu-boost: 'true'|--cpu-boost"; do
  grep -q -- "${pair%%|*}" cloudrun/service.yaml || { echo "service.yaml missing ${pair%%|*}"; exit 1; }
  grep -q -- "${pair#*|}" deploy-api.sh || { echo "deploy-api.sh missing ${pair#*|}"; exit 1; }
done
echo "ok   cloudrun limits consistent"
