#!/usr/bin/env bash
# Create the release tag vYYYY.MM.DD-N for HEAD (call only after a successful smoke test).
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
day="v$(date -u +%Y.%m.%d)"
n=1
while git rev-parse -q --verify "refs/tags/${day}-${n}" >/dev/null; do n=$((n + 1)); done
run git tag -a "${day}-${n}" -m "Release ${day}-${n}"
log "created ${day}-${n}; push it with: git push origin ${day}-${n}"
