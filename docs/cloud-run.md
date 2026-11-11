# Cloud Run service `certificates-api`

Region `us-east1`, deployed from source (`gcloud run deploy --source api`) by `infra/deploy-api.sh`; `infra/cloudrun/service.yaml` is its declarative twin (`infra/test-dry-run.sh` checks that the limits agree).

| Setting                              | Value                                                                     | Why                                                                |
| ------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| instances                            | min 0, max 3                                                              | scale to zero; max bounds worst-case spend and Firestore read burn |
| concurrency / CPU / memory / timeout | 80 / 1 vCPU / 512 MiB / 60 s                                              | spec §3, peak memory target 400 MiB                                |
| CPU allocation                       | only during requests (`--cpu-throttling`), startup CPU boost on           | cost; cold-start baseline for BEU-ICT/certificate-manager#394      |
| invoker                              | `allUsers` (`--allow-unauthenticated`), ingress `all`                     | Hosting reaches Cloud Run over the public path                     |
| identity                             | `certificates-api-runtime`                                                | `infra/iam.md`                                                     |
| probes                               | startup and liveness on `/internal/healthz`                               | the endpoint is added by the API tasks                             |
| config                               | env vars per `docs/config-matrix.md`; `EMAIL_API_KEY` from Secret Manager |                                                                    |

`/internal/**` is reachable on the Cloud Run URL but is **not** routed by Hosting (`docs/hosting.md`); the handlers enforce OIDC themselves (BEU-ICT/certificate-manager#368).

## Service URL

The first deploy runs without `SERVICE_URL`. Read the URL (`gcloud run services describe certificates-api --region us-east1 --format='value(status.url)'`), put it in `infra/.env` as `SERVICE_URL` and deploy again: it is the OIDC audience for Cloud Tasks.

## Not yet verified (needs the live project)

Deployed revision answers `/internal/healthz` with 200, `gcloud run services describe` shows the limits above, and instance count is 0 after 15 minutes idle.
