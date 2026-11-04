#!/usr/bin/env bash
# Read-only: list the effective org policies that can block the design and print a verdict.
# Writes nothing to the cloud. Use the output as evidence for docs/org-policies.md.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID

# constraint -> why it matters
declare -A WHY=(
  [storage.publicAccessPrevention]="blocks the public PDF bucket (allUsers objectViewer)"
  [iam.allowedPolicyMemberDomains]="blocks granting allUsers on the PDF bucket and Cloud Run invoker"
  [iam.disableServiceAccountKeyCreation]="no keys are used; enforced is GOOD (design needs no keys)"
  [gcp.resourceLocations]="must allow us-east1 (in:us-east1-locations or in:us-locations)"
  [run.requireInvokerIam]="would make the Cloud Run service private; Hosting rewrites need public invoker"
)

for c in "${!WHY[@]}"; do
  log "== constraints/${c}: ${WHY[$c]}"
  query gcloud resource-manager org-policies describe "constraints/${c}" \
    --project="${PROJECT_ID}" --effective --format=yaml 2>&1 || true
done
log "Record the verdict per constraint in docs/org-policies.md (blocking => exception requested, approver, date)."
