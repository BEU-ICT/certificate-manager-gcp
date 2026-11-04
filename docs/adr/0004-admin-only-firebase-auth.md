# 0004 Firebase Auth, administrators only

Status: accepted · Spec §2 · Issue #16 §4, §10

## Context

Only organisation staff issue and revoke certificates. Verifying a certificate is public and needs no account. Additional administrators and end-user accounts are out of scope for v1.

## Decision

Administrators sign in with Firebase Auth in the SPA and call the API with `Authorization: Bearer <Firebase ID token>`. The API verifies the token through the `TokenVerifier` port and authorises only tokens carrying the custom claim `role=admin` (401 `UNAUTHENTICATED` without a valid token, 403 `FORBIDDEN` without the claim). Authorisation is deny-by-default. The first administrator is created by the bootstrap migration (`BOOTSTRAP_ADMIN_EMAIL`); further administrators are added manually by an operator. The Firebase SDK is used for sign-in only and is isolated in one frontend `auth` module; the public route does not load it.

## Consequences

- No user table and no role editor in v1; the claim is the single source of authority.
- Swapping the identity provider only needs another `TokenVerifier` adapter.
- Second and later administrators are a future epic (#224).
