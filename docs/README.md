# docs

ADRs (`adr/`), runbooks and guides.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and on pushes to `dev`. Jobs: `lint` (ESLint + Prettier), `typecheck`, `depcruise`, `test:unit`, `test:integration` (Firebase emulators, Java 21), `build`, `docker-build` (no push), `audit` (`npm audit --omit=dev --audit-level=high`) and `gitleaks`. The aggregating job `ci` fails if any of them fails. Dependabot (`.github/dependabot.yml`) opens weekly npm and GitHub Actions updates.

Run the same checks locally from the repo root: `npm run lint -w api`, `npx prettier --check .`, `npm run typecheck -w api`, `npm run depcruise -w api`, `npm run test:unit -w api`, `npm run test:integration -w api` (needs Java), `npm run build -w api`.

### Making `ci` a required check

Branch protection is not available on the current plan. Once it is (or with a repository ruleset), require the status check named `ci` on `dev`: Settings -> Branches (or Rules -> Rulesets) -> require status checks to pass -> select `ci`. Only `ci` needs to be required; it already depends on every other job.
