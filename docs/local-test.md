# Manual local test plan

A start-to-finish checklist to run by hand on one machine before anything is deployed (BEU-ICT/certificate-manager#455). It needs **no GCP account, no Gmail and no network**: Firestore and Auth run in the Firebase emulators, files go to disk (`STORAGE_ADAPTER=fs`), e-mail goes to `.eml` files (`EMAIL_PROVIDER=file`), the queue runs in-process. Allow about 90 minutes. Fill in the [results table](#results) as you go.

Background: [development.md](development.md) (dev setup, seed, reading e-mail), [template-authoring.md](template-authoring.md) (packages), [api-hardening.md](api-hardening.md) (rate limits, headers).

## 1. Setup

Prerequisites: Node per `.nvmrc`, Java 21+ (emulators), a modern browser (Chromium or Firefox, with dev tools for the mobile-width test), `curl`, `python3` (to read mails), and a phone or a QR reader for step 11.

```bash
npm ci
npm run dev:local
```

`npm run dev:local` starts, in one terminal: the Firestore and Auth emulators (`127.0.0.1:8081` / `9099`), then waits until they answer, seeds them (`npm run seed:dev`) and starts the API on `http://localhost:8080` with `DB_ADAPTER=firestore`, `STORAGE_ADAPTER=fs`, `EMAIL_PROVIDER=file`, `QUEUE_ADAPTER=in-process`, and the SPA on `http://localhost:5173` against the Auth emulator. The first start downloads the emulator jars and takes a minute; it is ready when the `[api]` log shows `Server listening` and `[web]` shows the Vite URL.

> `api/.env` is **not** read by `npm run dev` (the API takes its settings from the process environment only), which is why `dev:local` sets them inline. Do not use the `.env` files for this test. Only emulator values are used; never enter real credentials.

| What                  | Where                                                              |
| --------------------- | ------------------------------------------------------------------ |
| SPA                   | http://localhost:5173                                              |
| API                   | http://localhost:8080 (the SPA proxies `/api/v1` to it)            |
| Administrator         | `admin@example.test` / `local-admin-password` (emulator only)      |
| Sent e-mail           | `api/.local-data/mail/*.eml`                                       |
| Stored templates/PDFs | `api/.local-data/storage/`                                         |
| Test inputs           | `api/.local-data/fixtures/` (from `npm run local:fixtures`, below) |

Seed content: organization "Demo Organization", event "Demo Event 2026", template `demo-organization-demo-event-2026-attendance-v0` (the `docs/templates/reference` package), three certificates (two active, one of them without e-mail; one revoked).

Generate the test inputs once, in a second terminal:

```bash
npm run local:fixtures
```

It writes broken and narrow template packages to `api/.local-data/fixtures/templates/` (`bad-json`, `no-config`, `no-font`, `bad-viewbox`, `has-script`, `ok-narrow`) and CSV files to `.../csv/` (`valid.csv`, `invalid-rows.csv`, `wrong-headers.csv`, `bulk-1200.csv`). Validate any package offline with `npm run template:validate -w api -- ../<path>`.

### Reading sent e-mail

```bash
ls -t api/.local-data/mail | head                      # newest first
python3 -c "import email,sys,email.policy as p;m=email.message_from_binary_file(open(sys.argv[1],'rb'),policy=p.default);print(m['To'],'|',m['Subject']);print(m.get_body(('plain',)).get_content())" api/.local-data/mail/<file>.eml
```

File names: `<timestamp>-cm-<certificateId>-<n>.eml` for certificate e-mail (`n` grows with every resend).

### Resetting

```bash
npm run local:reset
```

With the emulators running, this empties Firestore and the Auth emulator, deletes `api/.local-data/storage` and `api/.local-data/mail` and re-seeds (`--no-seed` after `--` skips the seed: `npm run local:reset -- --no-seed`). Reload the browser afterwards (sessions of deleted users end). The fixtures are kept. A full reset is also: stop `npm run dev:local`, `rm -rf api/.local-data`, start again.

To stop: `Ctrl+C` (stops all three processes). Emulator data is in memory only and vanishes then; the files in `api/.local-data` stay until reset.

## 2. Checklist

Each step: do it, compare with **Expect**, record Pass/Fail in the [results table](#results). Use a private window for the "signed out" cases.

### A. Administrator sign-in

1. **Guard.** Open `http://localhost:5173/admin/certificates` while signed out. _Expect:_ redirect to `/login`; after a successful sign-in you return to `/admin/certificates` (the original target).
2. **Wrong credentials.** Sign in with `admin@example.test` and a wrong password; then with an unknown e-mail. _Expect:_ the same message both times, "Email or password is incorrect" (no hint which part is wrong); empty fields show field errors, no request is sent.
3. **Sign in.** `admin@example.test` / `local-admin-password`. _Expect:_ you land on the dashboard; the header shows the account and a sign-out control.
4. **Sign out.** _Expect:_ back on `/login`; browser Back does not show admin pages (guard redirects); `curl -i localhost:8080/api/v1/admin/me` answers 401.
5. **Non-administrator.** In the Auth emulator create a user without admin rights, then sign in with it:
   ```bash
   curl -s -X POST "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=k" -H 'content-type: application/json' -d '{"email":"nobody@example.test","password":"local-nobody-password","returnSecureToken":true}' >/dev/null
   ```
   _Expect:_ "Your account has no administrator access"; no admin screen opens.
6. **Password reset (emulator behaviour).** `/login` > "Forgot password?" > enter `admin@example.test` > send. _Expect:_ the page always says "If this address belongs to an administrator, an email was sent", also for an unknown address (no account enumeration). **No e-mail is written**: the Auth emulator prints the link in the `[emulators]` log: `To reset the password for admin@example.test, follow this link: http://127.0.0.1:9099/emulator/action?...&newPassword=NEW_PASSWORD_HERE`. Open that link with `NEW_PASSWORD_HERE` replaced by a new password (e.g. `local-new-password`); the emulator page confirms. Sign in with the new password; the old one fails. Then restore it with `npm run local:reset` (the seed sets the default password again).
7. **Bootstrap e-mail.** On the first API start, with `BOOTSTRAP_ADMIN_EMAIL` set, the API creates that administrator and writes a "set your password" mail. `dev:local` sets it to the seeded account, so the account exists and no mail is needed; check `api/.local-data/mail` after a reset+restart only if you want to see the template (its link points to the emulator).

### B. Organizations

8. **Create.** Admin > Organizations > create "QA Org". _Expect:_ appears in the list with a slug (`qa-org`); an empty name is rejected in the form.
9. **Rename.** Rename it to "QA Organization". _Expect:_ list and event/certificate screens show the new name.
10. **Delete guard.** Create an event under it (step 12), then try to delete the organization. _Expect:_ refused with a message that it still has events/certificates (nothing deleted). An empty organization deletes cleanly after a confirmation dialog.

### C. Events

11. **List and filter.** Open Events. _Expect:_ "Demo Event 2026" under "Demo Organization"; the organization filter and pagination work.
12. **Create.** Create "QA Event" for "QA Organization". _Expect:_ appears in the list; an empty name is rejected in the form.
13. **Edit.** Change the name. _Expect:_ saved and shown.
14. **Delete guard.** Delete the demo event (which has certificates). _Expect:_ refused (still referenced); deleting an event without certificates succeeds.

### D. Templates

15. **List and detail.** Open Templates > the seeded template. _Expect:_ reference `…-attendance-v0`, a read-only view of `config.json`, the file list, a copy-reference button.
16. **Upload (valid).** Upload > pick the folder `docs/templates/portrait` for "QA Event" / type `attendance`. _Expect:_ success; a new template `qa-organization-qa-event-attendance-v0` (version number increases per upload of the same event and type); warnings such as `UNREFERENCED_FILE fonts/LICENSE.txt` are shown but do not block.
17. **Upload errors.** Upload each folder from `api/.local-data/fixtures/templates/`:

    | Folder        | Expect                                                        |
    | ------------- | ------------------------------------------------------------- |
    | `bad-json`    | rejected, `CONFIG_UNREADABLE` (config.json is not valid JSON) |
    | `no-config`   | rejected, `CONFIG_UNREADABLE` (config.json is missing)        |
    | `no-font`     | rejected, `FILE_NOT_FOUND` for `fonts.body`                   |
    | `bad-viewbox` | rejected, `SVG_VIEWBOX_MISMATCH`                              |
    | `has-script`  | rejected, `SVG_SCRIPT` (`<script>` not allowed)               |

    _Expect for all:_ an error list naming code and file, no template is created (Templates list unchanged), the form stays usable. Also try uploading with no folder selected (the submit is blocked) and a folder larger than the limits in the authoring guide section 11 if you have one.

18. **Preview.** On the portrait template (or the seeded one) open Preview, choose the preset "Typical", render. _Expect:_ a PDF is shown in the dialog with sample name, subject, date and a QR code; overriding a sample value (name, subject, skills, date) and rendering again shows it. The preset "Longest (maximum lengths)" either renders or reports a fit problem per field (see step 19).
19. **Text does not fit.** Upload `ok-narrow` (its name box is 120 pt wide, one line) for "QA Event". Preview it with the preset "Longest (maximum lengths)", and again with the name overridden to about 40 characters. _Expect:_ the preview is refused with a "does not fit" message naming the field; with the name overridden to `Ali` (and the other overrides short) it renders. Keep this template for step 24.
20. **Copy.** On a template choose Copy > target event "QA Event". _Expect:_ a new template version in the target event with identical files; the original is unchanged (templates are immutable).

### E. Single issuance

21. **Issue.** Certificates > Issue: organization "Demo Organization", event "Demo Event 2026", type attendance, template "latest", name `Test Person`, e-mail `test.person@example.com`, subject `Cloud Computing`, skills `Cloud; DevOps`. _Expect:_ success and navigation to the detail page; status active; e-mail status `pending` and within seconds `sent` (reload); a public link `http://localhost:5173/c/<id>`.
22. **E-mail written.** `ls -t api/.local-data/mail | head -1`. _Expect:_ a file `…-cm-<id>-1.eml` addressed to `test.person@example.com`; the text contains the public link, in Azerbaijani and English.
23. **Without e-mail.** Issue a second one with no e-mail. _Expect:_ status active, e-mail status `skipped`, no mail file, resend not offered.
24. **Validation.** Try an empty name, an invalid e-mail, a subject over 200 characters, a future date more than a few minutes ahead. _Expect:_ inline field errors, nothing issued.
25. **Does not fit.** Issue with template `ok-narrow` (choose it explicitly under "Template version") and a 60-character name. _Expect:_ rejected with a text-does-not-fit error (HTTP 422, `TEXT_DOES_NOT_FIT`), **nothing is stored** (the certificate count does not change).
26. **Idempotence.** Double-click the submit button once. _Expect:_ only one certificate (the form disables itself / the same idempotency key is reused).

### F. Bulk import wizard

27. **Template download.** Certificates > Import > download the XLSX and the CSV template. _Expect:_ files `certificates-template.xlsx` / `.csv` with headers in the current UI language and two example rows.
28. **CSV, valid.** Choose organization, event, type; upload `fixtures/csv/valid.csv`. _Expect:_ a preview of 3 rows, no errors, all columns recognised; the "common subject" field may stay empty because every row has a subject. Confirm. _Expect:_ 3 certificates issued, a result summary, rows with e-mail queued; two mail files appear (the row without e-mail sends none).
29. **XLSX, valid.** Open the downloaded `certificates-template.xlsx` in a spreadsheet program, replace the example rows with two of your own (keep the header), save as XLSX and import it. _Expect:_ same as step 28. Also import it with the header row in Azerbaijani (switch the language first and re-download the template): both header languages are accepted.
30. **Invalid rows.** Upload `fixtures/csv/invalid-rows.csv`. _Expect:_ the preview marks the bad rows (missing name, invalid e-mail, invalid date, subject too long) with the reason per cell, the valid row stays valid; "Download errors" gives `import-errors.csv`; you cannot start the import while errors remain (or only after removing them, per the wizard's wording). **Nothing is issued** for an invalid file (all-or-nothing).
31. **Wrong file.** Upload `fixtures/csv/wrong-headers.csv`, then a `.txt` or an image renamed `.csv`, and a file over 5 MB. _Expect:_ a blocking error (unknown columns / unsupported type / file too large), no preview.
32. **Common subject.** Import `valid.csv` after deleting the Subject cells and enter a common subject in the wizard. _Expect:_ rows use the common subject; without one, rows are flagged "subject required".
33. **Chunking.** Import `fixtures/csv/bulk-1200.csv`. _Expect:_ a progress display of 3 chunks (500 + 500 + 200); all 1,200 certificates are issued (Certificates list total grows by 1,200; check with the Event filter); the page stays responsive. Re-running the **same file** immediately must not double-issue the chunks that were already accepted (idempotency keys per chunk). Takes up to a few minutes; the mail directory fills with about 1,200 files.
34. **Rate limit during import.** While the 1,200 import runs, nothing special is expected: a `429` answer is waited out automatically ("waiting" phase), not shown as a failure.

### G. Certificate list and detail

35. **List.** Certificates. _Expect:_ newest first, columns owner, organization, event, status, e-mail status, date; total count; page size selector.
36. **Filters.** Filter by organization, event, status (revoked), e-mail status, issued-from/to; set an end date before the start date. _Expect:_ each filter narrows the list and the total; "Clear filters" resets; the invalid range shows "The end date must not be before the start date" and does not query.
37. **Detail.** Open `Test Person`. _Expect:_ all fields, status, e-mail status and attempts, the public-link card with copy button, the masked e-mail (revealable or masked per UI), revoke and resend actions.

### H. Revoke and resend

38. **Resend.** On `Test Person` choose Resend e-mail and confirm. _Expect:_ success message; a new file `…-cm-<id>-2.eml` in the mail directory; attempts count increases. A certificate without e-mail offers no resend.
39. **Revoke.** Revoke `Test Person` with a reason. _Expect:_ confirmation dialog first; then status `revoked` with date and reason; resend is no longer offered.
40. **Revoked is public-invisible.** Open `http://localhost:5173/c/<id>` of the revoked certificate. _Expect:_ a clear "revoked" page without a download; `curl -i localhost:8080/api/v1/public/certificates/<id>/pdf` answers `410`. If the PDF had been generated before the revoke (step 45), its file is deleted from `api/.local-data/storage/pdfs/` and the old `/pdfs/<key>.pdf` URL answers 404.

### I. Dashboard

41. **Statistics.** Open the dashboard. _Expect:_ totals for certificates, active, revoked, issued in the last 30 days and an e-mail delivery block, consistent with the list (after steps 21-40: totals include the 1,200 bulk ones). Statistics are cached for up to 60 s per API instance (`STATS_CACHE_SECONDS`); "Refresh" immediately again shows the "refreshed a moment ago, wait about 10 seconds" notice.

### J. Public pages (mobile width)

42. **Landing.** Open `http://localhost:5173/` at mobile width (browser dev tools, 375 × 812). _Expect:_ the "Verify a certificate" page, an ID field, "Administrator sign in" link; no horizontal scrolling; targets are comfortably tappable. Enter garbage: "not a valid certificate ID"; paste a full `/c/<id>` link: it is accepted.
43. **Certificate page.** Open `/c/<id>` of an active certificate (copy the id from the admin detail page) at 375 px width. _Expect:_ owner, subject, event, organization, date, skills; status "valid"; a PDF download action; the layout fits the width; no admin data and no e-mail address.
44. **Unknown ID.** `/c/AAAAAAAAAAAAAAAAAAAAAA` and `/c/xyz`. _Expect:_ a "not found" / invalid-ID page, never a stack trace.

### K. PDF and QR

45. **PDF download.** On the public page choose download (first time: generated on demand, a few seconds). _Expect:_ a PDF with the template artwork, name, subject, date and a QR code; it is the file `api/.local-data/storage/pdfs/…`; a second download is instant (same file). `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:8080/api/v1/public/certificates/<id>/pdf` prints `302 http://localhost:8080/pdfs/<key>.pdf`.
46. **QR scan.** Open the PDF full-screen and scan the QR code with a phone or QR reader. _Expect:_ it decodes to `http://localhost:5173/c/<id>`. On a phone this link only opens when the phone can reach your machine (same Wi-Fi, use the machine's address instead of `localhost`: `npm run dev -w @certificate-manager/web -- --host`); otherwise reading the decoded text is enough.
47. **Visual check.** _Expect:_ Azerbaijani letters (ə ı ö ü ç ş ğ) render correctly (`Aysel Məmmədova`); the layout matches `docs/templates/reference/golden.png` apart from the sample text.

### L. Language

48. **Switch.** Use the language switcher on the public landing page, the certificate page and the admin screens. _Expect:_ az (default) and en switch immediately without reload, on every screen, including errors, dialogs, dashboard and the import wizard; the choice persists after reload (`localStorage` key `cm.lang`); no raw keys (`certificates.importWizard…`) and no untranslated strings; the Azerbaijani letter forms are intact; the `<html lang>` changes.

### M. Security spot checks

49. **Headers.** With the API running: `scripts/check-headers.sh http://localhost:8080`. _Expect:_ `OK: security headers as expected` (CSP `default-src 'none'`, HSTS, nosniff, `Referrer-Policy: no-referrer`, CORP, X-Frame-Options, Permissions-Policy; `Cache-Control: no-cache` on public and `no-store` on admin; no `X-Powered-By`, no CORS headers, no stack-revealing `Server`).
50. **Public rate limit.** `for i in $(seq 1 13); do curl -s -o /dev/null -w "%{http_code} " localhost:8080/api/v1/public/certificates/does-not-exist; done; echo`. _Expect:_ eight or so `404`, then `429` (budget 10 per minute and client; the SPA and earlier steps may have used some). The 429 body is `{"error":{"code":"RATE_LIMITED",…}}` with `Retry-After` and `RateLimit-*` headers; after about a minute, 404 again.
51. **Admin guard.** `curl -i localhost:8080/api/v1/admin/certificates` without a token, and with `-H 'authorization: Bearer garbage'`. _Expect:_ 401 both, no data.
52. **Admin rate limit (optional).** More than 60 authenticated admin requests in a minute answer 429 (`RATE_LIMIT_ADMIN_PER_MIN`, default 60). The SPA's own use stays below it.

### N. Deferred to whole-platform testing

53. **Template authoring guide, human from-scratch test.** One person who did not write [template-authoring.md](template-authoring.md) follows it from a blank design file to an uploaded template and an issued PDF, using only the guide, and notes every place where they were stuck. This needs a designer's tool (Inkscape or Figma) and a real person, so it is **deferred to the whole-platform test** after deployment; record "Deferred" in the results table. The automated side (validator, golden renders of the three reference packages) already runs in CI.

## Results

Copy this table into your notes and fill it in. Result: Pass, Fail (with note), Blocked, Skipped.

| #   | Area                        | Result   | Date | Notes |
| --- | --------------------------- | -------- | ---- | ----- |
| 1   | Sign-in guard / redirect    |          |      |       |
| 2   | Wrong credentials           |          |      |       |
| 3   | Sign in                     |          |      |       |
| 4   | Sign out                    |          |      |       |
| 5   | Non-administrator           |          |      |       |
| 6   | Password reset (emulator)   |          |      |       |
| 7   | Bootstrap e-mail            |          |      |       |
| 8   | Organization create         |          |      |       |
| 9   | Organization rename         |          |      |       |
| 10  | Organization delete guard   |          |      |       |
| 11  | Events list/filter          |          |      |       |
| 12  | Event create                |          |      |       |
| 13  | Event edit                  |          |      |       |
| 14  | Event delete guard          |          |      |       |
| 15  | Template list/detail        |          |      |       |
| 16  | Template upload (valid)     |          |      |       |
| 17  | Template upload errors      |          |      |       |
| 18  | Template preview            |          |      |       |
| 19  | Text does not fit (preview) |          |      |       |
| 20  | Template copy               |          |      |       |
| 21  | Single issue                |          |      |       |
| 22  | Issue e-mail file           |          |      |       |
| 23  | Issue without e-mail        |          |      |       |
| 24  | Issue validation            |          |      |       |
| 25  | Text does not fit (issue)   |          |      |       |
| 26  | Double submit               |          |      |       |
| 27  | Import templates download   |          |      |       |
| 28  | CSV valid                   |          |      |       |
| 29  | XLSX valid                  |          |      |       |
| 30  | Invalid rows                |          |      |       |
| 31  | Wrong file                  |          |      |       |
| 32  | Common subject              |          |      |       |
| 33  | Chunking (1,200 rows)       |          |      |       |
| 34  | 429 during import           |          |      |       |
| 35  | Certificate list            |          |      |       |
| 36  | Filters                     |          |      |       |
| 37  | Certificate detail          |          |      |       |
| 38  | Resend e-mail               |          |      |       |
| 39  | Revoke                      |          |      |       |
| 40  | Revoked public behaviour    |          |      |       |
| 41  | Dashboard                   |          |      |       |
| 42  | Landing (mobile)            |          |      |       |
| 43  | `/c/:id` (mobile)           |          |      |       |
| 44  | Unknown ID                  |          |      |       |
| 45  | PDF download                |          |      |       |
| 46  | QR scan                     |          |      |       |
| 47  | PDF visual check            |          |      |       |
| 48  | az/en switch                |          |      |       |
| 49  | Security headers            |          |      |       |
| 50  | Public rate limit           |          |      |       |
| 51  | Admin guard                 |          |      |       |
| 52  | Admin rate limit            |          |      |       |
| 53  | Authoring guide human test  | Deferred |      |       |

## Not covered locally

These need the live project and belong to the deployment and launch issues in BEU-ICT/certificate-manager (epic E1 infrastructure, E9 e-mail, E10 hardening, E11/E12 launch; look them up in the board, project BEU-ICT #1). Run the matching checks after deployment.

| Not covered                                                                                              | Why                                                                | Where to verify                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real GCP: Cloud Run, Firestore, Cloud Storage buckets, IAM, org policies                                 | emulators and disk replace them                                    | `infra/verify-iam.sh` ([storage.md](storage.md)), [cloud-run.md](cloud-run.md), [firestore.md](firestore.md); IAM/bucket verification task E10-S5-T4 (#401) |
| GCS adapter against real buckets (public PDF URL, `Cache-Control`, listing)                              | fs adapter serves PDFs through the API                             | `npm run verify:pdf-lifecycle` (`scripts/README.md`), [storage.md](storage.md)                                                                              |
| Gmail / Brevo delivery, SPF/DKIM/DMARC, bounce handling, daily caps                                      | the file sink never sends                                          | [email-queue.md](email-queue.md), E9 tasks; send a real test mail after deploy                                                                              |
| Cloud Tasks queue and OIDC authentication of task requests                                               | `QUEUE_ADAPTER=in-process`                                         | [email-queue.md](email-queue.md), `docs/runbook.md`; deployment tasks of E9                                                                                 |
| Firebase Hosting: CSP and security headers of the SPA, rewrites to Cloud Run                             | Vite dev server sets no CSP; only the API headers are checked here | [hosting.md](hosting.md), `scripts/check-headers.sh https://<hosting-url>` against the deployed site and API                                                |
| Real Firebase Auth: password-reset e-mail, authorized domains, MFA, disabled users, `AUTH_CHECK_REVOKED` | emulator prints the link instead                                   | [auth-config.md](auth-config.md)                                                                                                                            |
| Performance, cold starts, load, cost, bundle budgets on real infrastructure                              | local timings are not representative                               | [performance.md](performance.md), [cost-model.md](cost-model.md), E10-S4                                                                                    |
| Logging, monitoring, alerts, error reporting in Cloud                                                    | no Cloud Logging/Monitoring locally                                | [logging.md](logging.md), E10-S3                                                                                                                            |
| Backups and restore                                                                                      | no managed Firestore                                               | [backup-restore.md](backup-restore.md)                                                                                                                      |
| Legacy data migration                                                                                    | needs production export                                            | [migration/](migration/), E12                                                                                                                               |
| Real mobile networks and phones scanning a deployed certificate                                          | local QR points to `localhost`                                     | final acceptance in the whole-platform test                                                                                                                 |
| Template authoring guide human from-scratch test                                                         | needs a person and a design tool                                   | step 53, whole-platform test                                                                                                                                |
