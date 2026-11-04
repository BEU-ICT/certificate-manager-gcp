#!/usr/bin/env bash
# Deploy the API to Cloud Run from source (ADR 0011). Limits per spec §3:
#   min 0 / max 3 instances, concurrency 80, 512 MiB, 1 vCPU, timeout 60 s, CPU only during
#   requests, startup CPU boost, public invoker (Hosting rewrites reach it; /internal/** enforces OIDC).
# Usage: DRY_RUN=1 infra/deploy-api.sh   |   infra/deploy-api.sh [--skip-checks]
# SERVICE_URL is the OIDC audience: the first deploy runs without it; the script then reads the
# service URL, prints it, and (re)applies it as the SERVICE_URL variable.
# shellcheck source=infra/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_env PROJECT_ID PUBLIC_BASE_URL BOOTSTRAP_ADMIN_EMAIL EMAIL_FROM_ADDRESS
preflight_deploy "$@"

SERVICE=certificates-api
RUNTIME="certificates-api-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
ENV_VARS="NODE_ENV=production,LOG_LEVEL=${LOG_LEVEL:-info},GCP_PROJECT=${PROJECT_ID}"
ENV_VARS+=",PUBLIC_BASE_URL=${PUBLIC_BASE_URL},PDF_PUBLIC_BASE_URL=https://storage.googleapis.com/${PROJECT_ID}-pdfs"
ENV_VARS+=",TEMPLATES_BUCKET=${PROJECT_ID}-templates,PDF_BUCKET=${PROJECT_ID}-pdfs"
ENV_VARS+=",TASKS_QUEUE=email-queue,TASKS_LOCATION=${REGION},TASKS_INVOKER_SA=tasks-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
ENV_VARS+=",BOOTSTRAP_ADMIN_EMAIL=${BOOTSTRAP_ADMIN_EMAIL},EMAIL_PROVIDER=${EMAIL_PROVIDER:-gmail}"
ENV_VARS+=",EMAIL_FROM_ADDRESS=${EMAIL_FROM_ADDRESS},EMAIL_FROM_NAME=${EMAIL_FROM_NAME:-Certificate Manager}"
ENV_VARS+=",DB_ADAPTER=firestore,STORAGE_ADAPTER=gcs,QUEUE_ADAPTER=cloud-tasks,AUTH_PROVIDER=firebase"
[[ -z "${SERVICE_URL:-}" ]] || ENV_VARS+=",SERVICE_URL=${SERVICE_URL}"

deploy() {
  run gcloud run deploy "${SERVICE}" --source "${INFRA_DIR}/../api" --region "${REGION}" \
    --project "${PROJECT_ID}" --allow-unauthenticated --ingress all \
    --min-instances 0 --max-instances 3 --concurrency 80 --memory 512Mi --cpu 1 --timeout 60 \
    --cpu-throttling --cpu-boost --service-account "${RUNTIME}" \
    --set-env-vars "^@^${ENV_VARS//,/@}" \
    --set-secrets "EMAIL_API_KEY=EMAIL_API_KEY:latest" \
    --startup-probe "httpGet.path=/internal/healthz,httpGet.port=8080,periodSeconds=2,failureThreshold=15" \
    --liveness-probe "httpGet.path=/internal/healthz,httpGet.port=8080,periodSeconds=30"
}
deploy

# Record the URL (OIDC audience); needs a second revision only the first time.
url="$(query gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" \
  --format='value(status.url)' || true)"
if [[ -n "${url}" && "${SERVICE_URL:-}" != "${url}" ]]; then
  log "SERVICE_URL=${url}  -> put it in infra/.env and run this script once more"
fi
log "smoke: curl -fsS <service-url>/internal/healthz ; limits: gcloud run services describe ${SERVICE} --region ${REGION}"
