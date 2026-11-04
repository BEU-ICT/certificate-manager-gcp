#!/usr/bin/env bash
# Offline self-test: every numbered script must complete under DRY_RUN=1 and print gcloud commands only.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export DRY_RUN=1 PROJECT_ID=test-project BILLING_ACCOUNT_ID=000000-000000-000000
export BUDGET_EMAILS="a@example.com b@example.com" OWNER_EMAILS="a@example.com b@example.com"
for s in [0-9][0-9]-*.sh check-*.sh; do
  [[ -f "$s" ]] || continue
  out="$(bash "$s" 2>&1)" || { echo "FAIL $s"; echo "$out"; exit 1; }
  echo "ok   $s"
done
