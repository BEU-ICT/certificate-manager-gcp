# Firebase Auth configuration (administrators only)

Status: written offline; **not yet applied to a live project** (BEU-ICT/certificate-manager#288 stays open until the steps below ran and `verify-auth-lockdown.sh` passed). Decision record: ADR 0016.

## Apply

```bash
# infra/.env: PROJECT_ID, FIREBASE_API_KEY (web API key of the Firebase web app)
infra/10-auth.sh              # DRY_RUN=1 prints the request only
infra/verify-auth-lockdown.sh # must print PASS
```

`10-auth.sh` sets: Email/Password only (email link, anonymous and phone off), user sign-up and self-deletion off, authorized domains = `<project>.web.app` and `<project>.firebaseapp.com` (plus `EXTRA_AUTH_DOMAIN`; `localhost` only with `ALLOW_LOCALHOST=1` on development projects), password policy (minimum 12 characters with upper case, lower case and a digit), improved e-mail privacy (enumeration protection).

If the API reports that Identity Platform is required, upgrade the project once in the Firebase console (Authentication) and rerun; record the result in ADR 0016.

## Manual steps in the console (no stable API)

1. Authentication → Templates → Password reset: sender name "Certificate Manager", subject in Azerbaijani and English (for example "Parolun sıfırlanması / Reset your password"). Add the `az` and `en` template variants as far as the console offers them.
2. The reset e-mail is sent from Firebase's default sender (`noreply@<project>.firebaseapp.com`), **not** from our Gmail account. It may land in spam; tell administrators to check the spam folder, and consider a custom sender domain later.
3. Restrict the web API key (Google Cloud console → APIs & Services → Credentials): application restriction "HTTP referrers" = `https://<project>.web.app/*`, `https://<project>.firebaseapp.com/*`; API restriction = "Identity Toolkit API" (and "Token Service API"). The key stays public, the restriction limits abuse.
4. Record the date of this review below and repeat it every six months.

| Reviewed on | By  | Notes |
| ----------- | --- | ----- |
| (pending)   |     |       |

## Acceptance checks (live project)

- `infra/verify-auth-lockdown.sh` passes.
- `createUserWithEmailAndPassword` from the browser SDK fails.
- A Firebase user without the `role=admin` claim signs in but is rejected by the API with 403 (covered offline by the API tests).
