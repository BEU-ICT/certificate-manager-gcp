#!/usr/bin/env bash
# Creates .env.onprem from .env.onprem.example with freshly generated random secrets.
# Refuses to overwrite an existing file. Prints where the generated admin password is.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -e .env.onprem ] && { echo ".env.onprem already exists; delete it first to regenerate." >&2; exit 1; }
rand() { openssl rand -base64 33 | tr -d '/+=\n' | cut -c1-32; }
cp .env.onprem.example .env.onprem
chmod 600 .env.onprem
for name in ADMIN_PASSWORD KEYCLOAK_ADMIN_PASSWORD POSTGRES_PASSWORD REDIS_PASSWORD MINIO_ROOT_PASSWORD S3_APP_SECRET_KEY; do
  sed -i "s|^${name}=.*|${name}=$(rand)|" .env.onprem
done
echo "Created .env.onprem (mode 600). Test admin: $(grep ^ADMIN_EMAIL= .env.onprem | cut -d= -f2) / password in ADMIN_PASSWORD of that file."
