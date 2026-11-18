# On-prem deployment guide

Deploy Certificate Manager on your own infrastructure without any Google Cloud service
(BEU-ICT/certificate-manager#442; spec §5.1). The same API image runs on Cloud Run and on-prem: only the adapter
selection and environment variables differ.

The repository ships a **reference / evaluation stack** (`docker-compose.onprem.yml`, `infra/onprem/README.md`). This
guide explains how to take it to a real deployment: what each capability needs, a production nginx configuration, TLS,
backups, upgrades, monitoring and a hardening checklist. Kubernetes is covered by notes only; no manifests are delivered.

## 1. Sizing and prerequisites

| Size                                | vCPU | RAM  | Disk                         | Notes                                                                                 |
| ----------------------------------- | ---- | ---- | ---------------------------- | ------------------------------------------------------------------------------------- |
| Evaluation / up to ~5 000 certs     | 2    | 4 GB | 20 GB SSD                    | everything on one host, as in the reference stack                                     |
| Production, bulk issuance of 1 000+ | 4    | 8 GB | 50 GB + about 100 KB per PDF | PDF rendering is CPU-bound: `PDF_MAX_CONCURRENT_RENDERS` (default 3) per API instance |

Prerequisites:

- Linux host (x86-64), Docker Engine 24+ with the Compose plugin, `openssl`, `git`, Node 22 only if you run the optional seed script.
- A DNS name for the web app and, for production, a certificate from your CA (or ACME). The reference stack uses a self-signed one.
- An SMTP relay you are allowed to send through (host, port, STARTTLS, credentials) and a sender address on a domain with SPF/DKIM set up.
- An OIDC provider (Keycloak, Authentik, Entra ID, ...): issuer URL, JWKS URI, an SPA client (authorization code + PKCE) and an `admin` role/claim for administrators.
- Outbound access is not required at runtime (images are pulled once).

## 2. Quick start (reference stack)

```bash
git clone https://github.com/BEU-ICT/certificate-manager-gcp.git && cd certificate-manager-gcp
./scripts/onprem-init-env.sh        # writes .env.onprem (mode 600) with random secrets
docker compose -f docker-compose.onprem.yml --env-file .env.onprem up --build -d
docker compose -f docker-compose.onprem.yml --env-file .env.onprem ps    # wait until all services are healthy
```

Open <https://localhost:8443> (accept the self-signed certificate), sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from
`.env.onprem`. Mail arrives in Mailpit (<http://localhost:8025>). To use another host name set `PUBLIC_ORIGIN`,
`KEYCLOAK_PUBLIC_URL` and `TLS_HOSTNAME` in `.env.onprem` before the first start. All ports are bound to `BIND_ADDRESS`
(default `127.0.0.1`).

## 3. Configuration matrix

The API selects one adapter per capability with an env var; unknown values stop the boot with a message that lists the
allowed names. Secrets must come from env files with mode 600, Docker/Compose secrets or your secret store, never from
the image or the repository. Full list of variables: [config-matrix.md](config-matrix.md).

| Capability                   | Selector                                         | On-prem value | Variables                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database                     | `DB_ADAPTER`                                     | `postgres`    | `DATABASE_URL` (secret) `postgres://user:pass@host:5432/db`; schema is created by the `migrate` one-shot (`node dist/adapters/postgres/migrate-cli.js`)                                                                                                   |
| Storage                      | `STORAGE_ADAPTER`                                | `s3`          | `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE=true` (MinIO), `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (secret), `TEMPLATES_BUCKET`, `PDF_BUCKET`                                                                                                     |
| Storage (single host, no S3) | `STORAGE_ADAPTER`                                | `fs`          | local directory on a persistent volume; PDFs are then served by the API instead of nginx                                                                                                                                                                  |
| Queue                        | `QUEUE_ADAPTER`                                  | `bullmq`      | `REDIS_URL` (secret, includes password), `WORKER_ENABLED=true` on the instance(s) that process jobs                                                                                                                                                       |
| Rate limiter                 | `RATE_LIMITER`                                   | `redis`       | uses `REDIS_URL`                                                                                                                                                                                                                                          |
| E-mail                       | `EMAIL_PROVIDER` (and `EMAIL_FALLBACK_PROVIDER`) | `smtp`        | `SMTP_HOST` (required), `SMTP_PORT` (587), `SMTP_TLS` = `starttls` (default, enforced) / `tls` / `none` (dev only, refused when `NODE_ENV=production`), `SMTP_USER`, `SMTP_PASSWORD` (secret), `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_DAILY_CAP` |
| Auth                         | `AUTH_PROVIDER`                                  | `oidc`        | `OIDC_ISSUER` (must equal the token `iss`, i.e. the URL browsers use), `OIDC_JWKS_URI` (may be an internal URL), `OIDC_AUDIENCE`; web build: `VITE_AUTH_PROVIDER=oidc`, `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`                                      |
| General                      |                                                  |               | `NODE_ENV=production`, `PORT=8080`, `LOG_LEVEL`, `GCP_PROJECT` (any label, e.g. `onprem`), `SERVICE_URL` / `PUBLIC_BASE_URL` / `PDF_PUBLIC_BASE_URL` (https origins without trailing `/`), `BOOTSTRAP_ADMIN_EMAIL`                                        |

Notes:

- `NODE_ENV=production` requires https URLs and forbids `SMTP_TLS=none`. The reference stack runs with `NODE_ENV=development` only because its bundled Mailpit speaks plain SMTP; **use `production` in a real deployment**.
- The API connects to the database and MinIO with dedicated least-privilege users, never with the superuser / root credentials. The reference stack's `minio-init` shows the bucket policies (`infra/onprem/minio/`).
- The web image bakes in the OIDC authority and client id at build time (Vite): rebuild `web` when they change.

## 4. nginx reference configuration

The reference stack's `infra/onprem/nginx/default.conf` serves the SPA, proxies the API and serves public PDFs from
MinIO. For production extend it as below (the `/internal` block and the extra headers are the differences). It terminates
TLS itself; if your organisation uses a separate TLS terminator, keep these locations and headers there.

```nginx
# Redirect plain HTTP.
server {
    listen 80;
    server_name certs.example.org;
    return 301 https://$host$request_uri;
}

map $request_uri $pdf_key_ok {
    default 0;
    ~^/pdfs/[^?]+[^/?]$ 1;          # an object key: no bucket listing, no trailing slash, no query
}

server {
    listen 443 ssl;
    http2 on;
    server_name certs.example.org;
    server_tokens off;

    ssl_certificate     /etc/nginx/tls/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    client_max_body_size 55m;       # template packages / bulk imports; the API enforces its own limits
    root /usr/share/nginx/html;     # the built SPA (web image)

    # Security headers, mirroring BEU-ICT/certificate-manager#385 (Firebase Hosting rules).
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "DENY" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    # Start with Content-Security-Policy-Report-Only for a week, then enforce. Replace the connect-src
    # origin with your OIDC provider (Firebase endpoints are not used on-prem).
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://login.example.org; frame-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;

    # Operational endpoints (health, task callbacks) are never reachable from outside.
    location ^~ /internal/ { return 404; }

    # API: never cached, real client address forwarded.
    location /api/v1/ {
        proxy_pass http://api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, never append client-supplied values
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
        add_header Cache-Control "no-store" always;
        # nginx drops parent add_header directives in a location that defines its own:
        # repeat the security headers (use an include file in practice).
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    # Public PDFs straight from the bucket: GET/HEAD only, objects only, no listing.
    location /pdfs/ {
        autoindex off;
        limit_except GET HEAD { deny all; }
        if ($pdf_key_ok = 0) { return 404; }
        if ($args != "") { return 404; }
        proxy_pass http://minio:9000/cm-pdfs/;
        proxy_set_header Host minio:9000;
        proxy_hide_header Set-Cookie;
        proxy_hide_header x-amz-request-id;
        proxy_hide_header x-amz-id-2;
        proxy_hide_header Server;
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-cache" always;     # revoked PDFs must disappear immediately
        add_header X-Content-Type-Options "nosniff" always;
        add_header Content-Security-Policy "default-src 'none'; sandbox" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    }

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Content-Type-Options "nosniff" always;
    }

    # SPA: every other path (deep links such as /c/<id>) serves index.html. Login and admin HTML: no-store.
    location ~ ^/(login|admin)(/|$) {
        try_files /index.html =404;
        add_header Cache-Control "no-store" always;
        # repeat the security headers here as well (include file)
    }
    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache" always;
        # repeat the security headers here as well (include file)
    }
}
```

Practical advice: put the security headers in one file (`include /etc/nginx/snippets/security-headers.conf;`) and
include it in every `location` that sets its own `add_header`. Check the result with `curl -sI https://certs.example.org/`,
`curl -si https://certs.example.org/internal/healthz` (404) and `curl -si https://certs.example.org/pdfs/` (404).

## 5. TLS

- Production: a certificate from your CA or ACME (certbot, step-ca). Mount `fullchain.pem` / `privkey.pem` read-only into the `web` container; reload with `docker compose exec web nginx -s reload` after renewal.
- The reference stack generates a self-signed certificate (volume `certs`, valid 825 days); browsers warn once.
- Keep TLS 1.2+ only, enable HSTS only after HTTPS works everywhere (including the Keycloak/OIDC URL: it must be https in production).
- API to PostgreSQL / Redis / MinIO inside the Docker network is plain TCP by default; if these run on other hosts use TLS (`sslmode=require` in `DATABASE_URL`, `rediss://`, an https `S3_ENDPOINT`).

## 6. Backups and restore

| What          | Backup                                                                                                              | Restore                                                 | Notes                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| PostgreSQL    | `docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > cm-$(date +%F).dump`      | `pg_restore -d <empty db> cm.dump` (stop the API first) | system of record: daily at least, keep 7-30 days, copy off-host           |
| File storage  | `mc mirror` both buckets (`cm-templates`, `cm-pdfs`) to another host, or snapshot the `miniodata` volume while idle | `mc mirror` back                                        | templates cannot be re-created; PDFs can be re-rendered from certificates |
| Identity      | Keycloak realm export (`kc.sh export`) or volume snapshot                                                           | re-import                                               | users created after the first import live only in the volume              |
| Redis         | not required                                                                                                        | -                                                       | only queued mail jobs; losing it loses unsent jobs, not certificates      |
| Configuration | `.env.onprem`, nginx config, compose file in your secret store / config management                                  | -                                                       | never in a public repository                                              |

Test a restore on a scratch host at least once per quarter and after every major upgrade.

## 7. Upgrade procedure

1. Read the release notes and `git diff <old>..<new> -- docker-compose.onprem.yml .env.onprem.example infra/onprem` for new variables.
2. Take a PostgreSQL dump and a MinIO mirror (section 6).
3. `git pull`, add new variables to `.env.onprem`, then `docker compose -f docker-compose.onprem.yml --env-file .env.onprem up --build -d`. The `migrate` one-shot applies schema migrations before the API starts; the API does not become healthy if it fails (`docker compose logs migrate`).
4. Verify: `docker compose ps` (all healthy), sign in, issue a test certificate, open its public page and PDF.
5. Rollback: stop the stack, restore the dump into an empty database, check out the previous tag, `up --build -d`. Migrations are forward-only; do not run a new schema with old code.

Images in the reference compose are pinned by digest; update digests deliberately and test before rolling out.

## 8. Monitoring hints

- Health: `GET /internal/healthz` on the API container (used by the Compose healthcheck); not exposed through nginx. Probe it from the host with `docker compose exec api wget -qO- http://127.0.0.1:8080/internal/healthz`.
- Logs: the API writes one JSON line per event to stdout (`docker compose logs -f api`); ship them with your log agent (Loki/Promtail, Filebeat, journald). Request ids are in every line. Recipient addresses and secrets are not logged.
- Alert on: container restarts, unhealthy services, 5xx rate on `/api/v1`, queue backlog (`redis-cli LLEN` on the BullMQ wait list or a Bull board), bounced/failed mail (`REJECTED` statuses in the admin UI), disk usage of the `pgdata` and `miniodata` volumes, TLS certificate expiry (< 14 days), and a failing nightly backup.
- Use an external HTTPS probe on `/` and on a known public certificate page.

## 9. Kubernetes notes (not delivered)

No Helm chart or manifests ship with the project. If you run on Kubernetes: one `Deployment` for the API (the image is stateless; set `WORKER_ENABLED=true` on at least one replica, any number may serve HTTP) with `/internal/healthz` as readiness and liveness probe; the web image as a second `Deployment` behind an `Ingress` (use the nginx location rules above, in particular blocking `/internal/` and the `/pdfs/` restrictions); a `Job` (or Helm hook / init container) running `node dist/adapters/postgres/migrate-cli.js` before each rollout; PostgreSQL, Redis and S3 as managed or operator-run services; secrets from `Secret` objects or an external secret store; a `NetworkPolicy` allowing only the web tier to reach the API and the API to reach the data stores.

## 10. Hardening checklist

- [ ] `NODE_ENV=production`; all `*_URL` / origins are https.
- [ ] No default or shared passwords: every secret generated randomly (`onprem-init-env.sh` does this), `.env.onprem` mode 600 and outside version control.
- [ ] Only nginx (80/443) and the OIDC provider are reachable from users; PostgreSQL, Redis, MinIO (API and console) and the API port are bound to localhost or an internal network (`BIND_ADDRESS`, firewall).
- [ ] `/internal/**` returns 404 from outside; `curl https://<host>/pdfs/` and a query string on `/pdfs/<key>` return 404.
- [ ] Public bucket policy: `GetObject` on `cm-pdfs` only, no listing; `cm-templates` private.
- [ ] API uses a least-privilege database role and a MinIO user restricted to the two buckets.
- [ ] Redis with a password and `noeviction`; not published.
- [ ] Keycloak (or other OIDC provider) in production mode with its own database, https, self-registration off, brute-force protection on; `start-dev` and the imported test admin removed.
- [ ] SMTP over STARTTLS/TLS (`SMTP_TLS` not `none`), authenticated relay, SPF/DKIM/DMARC for the sender domain.
- [ ] Security headers present (Observatory check), CSP moved from report-only to enforced.
- [ ] Container images pinned by digest and rebuilt regularly; host OS patched; Docker daemon not exposed on TCP.
- [ ] Log shipping, alerts and off-host backups with a tested restore (sections 6 and 8).
- [ ] Administrators limited to named people (the `admin` role); the bootstrap admin address reviewed.
