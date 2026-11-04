# auth

The only module allowed to import the Firebase SDK (enforced by ESLint `no-restricted-imports`).
It is imported from the admin routes only, so Firebase ships in the admin bundle and never in the
root or public chunks (`npm run check:bundle`). Session handling and sign-out arrive with #73.
