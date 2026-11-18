# On-prem reference stack

`docker-compose.onprem.yml` (repository root) runs the whole application on one host with no cloud
services: the spec §5.1 on-prem profile (BEU-ICT/certificate-manager#440).

| Service                | Role                                                                                                                                                                | Published (localhost only)       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `web`                  | nginx: SPA, `/api/v1` proxy, public PDFs from MinIO (`/pdfs/<key>`), self-signed TLS                                                                                | `https://localhost:8443`         |
| `api`                  | the same image as Cloud Run; `DB_ADAPTER=postgres`, `STORAGE_ADAPTER=s3`, `QUEUE_ADAPTER=bullmq`, `RATE_LIMITER=redis`, `EMAIL_PROVIDER=smtp`, `AUTH_PROVIDER=oidc` | internal only                    |
| `migrate`              | one-shot: PostgreSQL schema migrations before the API starts                                                                                                        | -                                |
| `postgres`             | database                                                                                                                                                            | `127.0.0.1:5432`                 |
| `minio` + `minio-init` | S3 storage; buckets `cm-templates` (private) and `cm-pdfs` (anonymous GetObject only, no listing); least-privilege app user                                         | `127.0.0.1:9000`, console `9001` |
| `redis`                | BullMQ queue and rate limiter (password, `noeviction`)                                                                                                              | internal only                    |
| `mailpit`              | SMTP catcher; web UI shows every mail                                                                                                                               | `http://localhost:8025`          |
| `keycloak`             | OIDC provider, realm `certificate-manager` imported at start (client `certificate-manager-web`, role `admin`, one test admin)                                       | `http://localhost:8180`          |
| `certs`                | one-shot: self-signed TLS certificate for nginx (volume `certs`)                                                                                                    | -                                |

This is a **reference / evaluation stack**: Keycloak runs in `start-dev` mode, TLS is self-signed, and the API runs with
`NODE_ENV=development` because the bundled Mailpit speaks plain SMTP (the API forbids `SMTP_TLS=none` in production).
For real use put your own TLS terminator in front and replace Keycloak/Mailpit with production services; the API only needs the same variables.

## Start

```bash
./scripts/onprem-init-env.sh                 # writes .env.onprem (mode 600) with random secrets; no passwords are committed
docker compose -f docker-compose.onprem.yml --env-file .env.onprem up --build -d
docker compose -f docker-compose.onprem.yml --env-file .env.onprem ps     # wait until everything is healthy
npm ci && npm run seed:onprem                 # demo organization, event, template and certificates (optional, idempotent)
```

Open <https://localhost:8443> (accept the self-signed certificate once) and sign in with the Keycloak user
`ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env.onprem`. The Keycloak admin console (`http://localhost:8180`) uses
`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`. Mails land in Mailpit at <http://localhost:8025>.

Walk-through: issue a certificate (e-mail it to any address) -> read it in Mailpit -> open the public page from the link ->
download the PDF (`/pdfs/<key>` served by nginx from MinIO) -> revoke it in the admin app -> the public PDF endpoint answers 410
and the PDF object is gone (`/pdfs/<key>` returns 404 immediately).

## Configuration

Everything is in `.env.onprem` (template: `.env.onprem.example`); every secret is required, there are no default passwords.
`BIND_ADDRESS` (default `127.0.0.1`) controls all published ports. To use another host name set `PUBLIC_ORIGIN`,
`KEYCLOAK_PUBLIC_URL` and `TLS_HOSTNAME` before the first start. The browser-facing Keycloak URL and the realm's redirect
URIs are fixed at the first import: after changing them run `docker compose ... down -v` (see Reset).

Images are pinned by digest; update the digests deliberately. The web image is built from `web/Dockerfile`
(`VITE_AUTH_PROVIDER=oidc`, no Firebase code), the API image from `api/Dockerfile`.

## Reset

```bash
docker compose -f docker-compose.onprem.yml --env-file .env.onprem down -v   # removes ALL data volumes
```

Without `-v` data survives restarts (volumes `pgdata`, `miniodata`, `redisdata`, `mailpitdata`, `keycloakdata`, `certs`).

## Backup hints

- PostgreSQL: `docker compose ... exec postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > cm.sql` (restore with `psql`).
- MinIO: `mc mirror` both buckets (`cm-templates`, `cm-pdfs`) or snapshot the `miniodata` volume while idle. PDFs are re-creatable from certificates, templates are not.
- Keycloak: the realm is re-imported from `infra/onprem/keycloak/`, but users created later live in the `keycloakdata` volume: export them (`kc.sh export`) or snapshot the volume.
- Redis holds only queue state (`appendonly yes`); losing it loses unsent mail jobs, not certificates.

## Security notes

- Ports are bound to localhost; nothing but `web` (8443) and Keycloak (8180) needs to be reachable by browsers.
- `/internal/**` is not proxied. The public bucket policy allows `GetObject` on `cm-pdfs` only; nginx serves `/pdfs/` with GET/HEAD, no
  trailing-slash or query (listing) requests, `Cache-Control: no-cache`, `nosniff`, and a sandboxing CSP.
- The API connects to MinIO as a dedicated user limited to the two buckets, not as the MinIO root user.
