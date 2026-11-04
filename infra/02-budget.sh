#!/usr/bin/env bash
# Budgets of $1 and $5 per month (alerts at 50/90/100%) that email at least two people.
# Billing admins/users of the billing account receive budget emails by default; the extra
# recipients get Cloud Monitoring email notification channels attached to each budget.
# Only the (free) Monitoring API is enabled here; nothing that bills is created.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID BILLING_ACCOUNT_ID BUDGET_EMAILS

read -r -a EMAILS <<<"${BUDGET_EMAILS}"
[[ ${#EMAILS[@]} -ge 2 ]] || die "BUDGET_EMAILS needs at least two addresses"

run gcloud services enable monitoring.googleapis.com cloudbilling.googleapis.com \
  billingbudgets.googleapis.com --project="${PROJECT_ID}"

CHANNELS=()
for email in "${EMAILS[@]}"; do
  existing="$(query gcloud beta monitoring channels list --project="${PROJECT_ID}" \
    --filter="type=email AND labels.email_address=${email}" --format='value(name)' || true)"
  if [[ -n "${existing}" ]]; then
    CHANNELS+=("${existing}")
  else
    name="$(run gcloud beta monitoring channels create --project="${PROJECT_ID}" \
      --display-name="Budget alert ${email}" --type=email \
      --channel-labels="email_address=${email}" --format='value(name)' || true)"
    CHANNELS+=("${name:-<channel-for-${email}>}")
  fi
done
CHANNEL_LIST="$(IFS=,; echo "${CHANNELS[*]}")"

for amount in 1 5; do
  display="cert-manager-${amount}usd"
  if [[ -n "$(query gcloud billing budgets list --billing-account="${BILLING_ACCOUNT_ID}" \
    --filter="displayName=${display}" --format='value(name)' || true)" ]]; then
    log "budget ${display} exists, skipping"
    continue
  fi
  run gcloud billing budgets create --billing-account="${BILLING_ACCOUNT_ID}" \
    --display-name="${display}" \
    --filter-projects="projects/${PROJECT_ID}" \
    --budget-amount="${amount}USD" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
    --notifications-rule-monitoring-notification-channels="${CHANNEL_LIST}"
done
log "done. Verify with the console budget 'test' or a temporarily lowered threshold (docs/budget-alerts.md)"
