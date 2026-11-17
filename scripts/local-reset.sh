#!/usr/bin/env bash
# Resets the local test data (docs/local-test.md): empties the Firestore and Auth emulators, deletes
# the local files (stored templates and PDFs, sent e-mail) and re-seeds. `npm run local:reset`.
# Refuses anything that is not an emulator project on localhost. Pass --no-seed to skip the seeding.
set -euo pipefail
cd "$(dirname "$0")/.."

project="${GCP_PROJECT:-demo-certificate-manager}"
fs_host="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8081}"
auth_host="${FIREBASE_AUTH_EMULATOR_HOST:-127.0.0.1:9099}"
local_re='^(127\.0\.0\.1|localhost|\[::1\]):[0-9]+$'

[[ "$project" == demo-* ]] || { echo "local-reset: GCP_PROJECT must start with demo-" >&2; exit 1; }
[[ "$fs_host" =~ $local_re && "$auth_host" =~ $local_re ]] || { echo "local-reset: emulator hosts must be local" >&2; exit 1; }

curl -fsS -X DELETE "http://$fs_host/emulator/v1/projects/$project/databases/(default)/documents" >/dev/null ||
  { echo "local-reset: Firestore emulator not reachable at $fs_host (run npm run dev:emulators)" >&2; exit 1; }
curl -fsS -X DELETE "http://$auth_host/emulator/v1/projects/$project/accounts" >/dev/null ||
  { echo "local-reset: Auth emulator not reachable at $auth_host" >&2; exit 1; }
rm -rf api/.local-data/storage api/.local-data/mail
echo "Emulators, api/.local-data/storage and api/.local-data/mail cleared."

if [[ "${1:-}" != "--no-seed" ]]; then
  FIRESTORE_EMULATOR_HOST="$fs_host" FIREBASE_AUTH_EMULATOR_HOST="$auth_host" npm run --silent seed:dev
fi
