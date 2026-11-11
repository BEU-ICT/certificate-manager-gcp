# 0016 Disable sign-up through the Identity Platform configuration

Status: proposed (to be confirmed on the live project) · Spec §10 · Issue/PR: BEU-ICT/certificate-manager#288

## Context

Firebase Auth lets anyone with the public web API key call `accounts:signUp`. The spec requires that nobody but the bootstrap flow creates accounts. The setting that disables user sign-up (`client.permissions.disabledUserSignup`) belongs to the Identity Platform configuration; whether it can be changed on a project that uses plain Firebase Auth, or requires upgrading the project to Identity Platform, could not be verified offline. Identity Platform bills per monthly active user beyond a free tier that far exceeds our number of administrators; the project is already on the Blaze plan.

## Decision

We will apply the lockdown with `infra/10-auth.sh` (Identity Toolkit admin API). If the API answers that Identity Platform is required, the operator upgrades the project once in the console (Authentication → "Upgrade"), reruns the script and records the outcome here (status → accepted). The backend does not rely on the setting: it rejects every token without `role=admin` (ADR 0004, defence in depth). `infra/verify-auth-lockdown.sh` must pass after every change of the Auth configuration.

## Consequences

- With a handful of administrators the Identity Platform cost stays at zero; check the pricing page when upgrading.
- Until the live run, the "sign-up is blocked" acceptance criterion of BEU-ICT/certificate-manager#288 is open; the backend still refuses non-admin users.
- The web API key is public by design, so its restrictions (HTTP referrers = Hosting domains, API restriction = Identity Toolkit) are part of the checklist in `docs/auth-config.md`; review date is recorded there.
