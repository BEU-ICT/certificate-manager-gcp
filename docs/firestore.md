# Firestore setup

- Database: `(default)`, Native mode, `us-east1` (ADR 0014). Only the `(default)` database gets the free quota. The location cannot be changed after creation.
- Rules: `infra/firestore.rules` denies every client read and write; only the API's runtime service account (Admin SDK) reaches data. Tested by `api/test/integration/firestore-rules.integration.test.ts` (unauthenticated, authenticated and admin-claim clients, ten collections), run in CI with the integration job.
- Indexes: `infra/firestore.indexes.json` holds the seven composite indexes of issue #16 §5 and spec §6, and the TTL policies on `expiresAt` for `idempotency` and `email_counters`. No single-field index exemptions are used, so write cost is the default.
- Create and deploy: `infra/04-firestore.sh` (`DRY_RUN=1` first). Deploy only rules and indexes later with `firebase deploy --only firestore:rules,firestore:indexes`.

## Verifying on the live project (not done yet)

1. `gcloud firestore databases describe --database='(default)'` shows `locationId: us-east1`.
2. `gcloud firestore indexes composite list` shows all indexes `READY`; `gcloud firestore fields ttls list` lists both TTL fields.
3. The index-merging check (#116) passes against the real database for all 63 filter combinations.
