# 0014 Token revocation check is off by default

Status: accepted · Spec §10 · Issue/PR: #64

## Context

The `TokenVerifier` adapter can ask Firebase Auth whether a token's user was disabled or had their sessions revoked (`checkRevoked`). That costs one Auth API call per admin request. Firebase ID tokens live one hour, and there are very few administrators.

## Decision

We will verify tokens locally (signature, expiry, issuer and audience against `GCP_PROJECT`, public keys cached by the SDK) and keep `AUTH_CHECK_REVOKED=false` by default. An operator sets `AUTH_CHECK_REVOKED=true` and redeploys when an admin account is suspected to be compromised; disabled or revoked users are then rejected immediately.

## Consequences

- Admin requests add no network call to Firebase Auth; median verification stays within the 5 ms budget.
- A disabled admin keeps access for up to one hour (token lifetime) unless the flag is on.
- Every verification failure returns the same 401 body; the reason is only logged, without the token.
