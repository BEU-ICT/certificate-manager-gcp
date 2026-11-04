#!/usr/bin/env bash
# Rollback helpers (see docs/runbook.md). Usage:
#   infra/rollback.sh api <revision>      route 100% of traffic to a previous Cloud Run revision
#   infra/rollback.sh web                 print the Hosting rollback command (interactive in the console/CLI)
#   infra/rollback.sh rules <git-tag>     redeploy rules/indexes from a previous release tag
#   infra/rollback.sh revisions           list recent revisions
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID
case "${1:-}" in
  revisions) run gcloud run revisions list --service certificates-api --region "${REGION}" --project "${PROJECT_ID}" --limit 10 ;;
  api)
    rev="${2:?revision name required (see: rollback.sh revisions)}"
    run gcloud run services update-traffic certificates-api --region "${REGION}" \
      --project "${PROJECT_ID}" --to-revisions "${rev}=100" ;;
  web) log "run: firebase hosting:rollback --project ${PROJECT_ID}  (or pick a version in the console)" ;;
  rules)
    tag="${2:?release tag required}"
    log "check out ${tag} in a clean clone, then run infra/deploy-rules.sh --skip-checks" ;;
  *) die "usage: rollback.sh api <revision> | web | rules <tag> | revisions" ;;
esac
