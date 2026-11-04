#!/usr/bin/env bash
# Shared helpers for infra scripts. Source it; do not execute it.
# Every script is idempotent and supports DRY_RUN=1 (prints gcloud commands, runs nothing).
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load operator settings (never committed): infra/.env, see infra/.env.example.
if [[ -f "${INFRA_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  source "${INFRA_DIR}/.env"
fi

REGION="${REGION:-us-east1}"
DRY_RUN="${DRY_RUN:-0}"

log() { printf '[%s] %s\n' "$(basename "$0")" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# require_env VAR... : abort when a variable is unset or still a placeholder.
require_env() {
  local v
  for v in "$@"; do
    [[ -n "${!v:-}" && "${!v}" != *CHANGE_ME* ]] || die "${v} is not set (see infra/.env.example)"
  done
}

# run CMD...: execute, or only print under DRY_RUN=1.
run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[dry-run] %s\n' "$*" >&2
  else
    "$@"
  fi
}

# query CMD...: read-only command; under DRY_RUN it is only printed and reports failure
# ("resource not found"), so scripts show the commands that would create things.
query() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '[dry-run query] %s\n' "$*" >&2
    return 1
  fi
  "$@"
}

# preflight_deploy [--skip-checks]: guards for production changes (ADR 0011).
#  - clean working tree, on `dev` or at a release tag
#  - PROJECT_ID equals EXPECTED_PROJECT_ID (set in infra/.env) when that is set
#  - tests green locally (unless --skip-checks)
#  - explicit confirmation of the project name; `ASSUME_YES=1` skips the prompt (never for production)
preflight_deploy() {
  local skip=0
  [[ "${1:-}" == "--skip-checks" ]] && skip=1
  require_env PROJECT_ID
  if [[ -n "${EXPECTED_PROJECT_ID:-}" && "${PROJECT_ID}" != "${EXPECTED_PROJECT_ID}" ]]; then
    die "PROJECT_ID ${PROJECT_ID} != EXPECTED_PROJECT_ID ${EXPECTED_PROJECT_ID}"
  fi
  if [[ "${DRY_RUN}" == "1" ]]; then
    log "dry run: skipping git, test and confirmation checks"
    return 0
  fi
  local root branch
  root="$(cd "${INFRA_DIR}/.." && pwd)"
  [[ -z "$(git -C "${root}" status --porcelain)" ]] || die "working tree is not clean"
  branch="$(git -C "${root}" rev-parse --abbrev-ref HEAD)"
  if [[ "${branch}" != "dev" ]] && ! git -C "${root}" describe --exact-match --tags HEAD >/dev/null 2>&1; then
    die "deploy from branch dev or from a release tag (on ${branch})"
  fi
  if [[ "${skip}" == "0" ]]; then
    (cd "${root}" && npm run test:unit -w api && npm run build -w api) || die "tests/build failed (use --skip-checks only in emergencies)"
  fi
  if [[ "${ASSUME_YES:-0}" != "1" ]]; then
    read -r -p "Change PRODUCTION project '${PROJECT_ID}'? Type the project id to continue: " answer
    [[ "${answer}" == "${PROJECT_ID}" ]] || die "confirmation failed"
  fi
}
