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
