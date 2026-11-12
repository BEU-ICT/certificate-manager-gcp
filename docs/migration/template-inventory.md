# Legacy template inventory and mappings

Task BEU-ICT/certificate-manager#404 (story #403, epic #402). Status: **draft for product-owner review**. Everything marked _pending_ needs production data or a stakeholder decision that is not available in the repositories.

Sources: the legacy checkout at commit `7cfc2cc` (22 May 2025), `backend/src/main/resources/templates/certificate/` (9 files) and three files at the repository root (`conf-ix-*.html`). Machine-readable mapping: [`scripts/migration/template-mapping.json`](../../scripts/migration/template-mapping.json), checked against this document by `npm run migration:validate-template-mapping`.

## 1. How the legacy system renders (facts that matter for the conversion)

- Thymeleaf renders an HTML file, **Flying Saucer** (`flying-saucer-pdf` 9.11.2, a CSS 2.1 renderer) turns it into the PDF. There is no font embedding code in the backend and the Docker image (`gradle:8-jdk21-alpine`) has no Microsoft fonts, so `MS Gothic`, `Tahoma` and `Times New Roman` were almost certainly **not** the fonts in the issued PDFs. Which fonts were really used must be confirmed from an issued PDF (section 9, item 4).
- The `template` column of a certificate is free text typed in the admin form (`CreateCertificateComponent.jsx`, a plain input) and used verbatim as the file name: `FileTemplateResolver`, prefix `./templates/certificate/`, suffix `.html`, **read from the file system at run time, not from the jar**. The production directory may therefore contain files that are not in the repository (and the three `conf-ix-*` files at the repository root were not in that directory unless copied by hand). The directory listing of production is needed (section 9, item 2).
- Variables available to a template: `fullName`, `activityName` (the certificate's `activity`), `certificateType` (free text such as `CERTIFICATE OF PARTICIPATION`), `QR` (PNG data, 500 px), `hashUrl` (`<base>/certificates/<hash>`). No date is passed: dates in the artwork are literal text.

## 2. Inventory

`-825` is **not** a page-size variant: every `-825` file has the same CSS and page as its base file. It is the **BoostCamp 8.0 (February 2025) edition** of the base **BoostCamp 7.0 (February 2024)** template: different partner logos (five instead of three, see section 5), the heading `BoostCamp 8.0` and the dates `1-14 February 2025` instead of `1-9 February 2024`. (The suffix probably stands for "8.0, 2025"; nothing in the code says so, so the product owner should confirm.)

The certificate counts come from `SELECT template, COUNT(*) FROM certificate GROUP BY template` on the production database and are _pending_ (no database access from this repository). Until they are filled in, no template is marked "not migrated".

<!-- BEGIN INVENTORY -->

| Legacy template (`certificate.template`) | File                                                    | Edition / event                                     | Page                   | Fields rendered                                                                 | Certificates in production | Proposed organization / event / type                        | New reference                                                | Status             |
| ---------------------------------------- | ------------------------------------------------------- | --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------ |
| `certificate-student`                    | `templates/certificate/certificate-student.html`        | BoostCamp 7.0 (1-9 Feb 2024)                        | A4 portrait            | type heading, fullName, "has attended", activity, fixed text, QR, URL           | _pending_                  | beu-ict-lab / boostcamp-7 / student                         | `beu-ict-lab-boostcamp-7-student-v0`                         | migrate (proposed) |
| `certificate-student-825`                | `templates/certificate/certificate-student-825.html`    | BoostCamp 8.0 (1-14 Feb 2025)                       | A4 portrait            | same as above                                                                   | _pending_                  | beu-ict-lab / boostcamp-8 / student                         | `beu-ict-lab-boostcamp-8-student-v0`                         | migrate (proposed) |
| `certificate-instructor`                 | `templates/certificate/certificate-instructor.html`     | BoostCamp 7.0                                       | A4 portrait            | same; text "has provided exceptional training in … class during …"              | _pending_                  | beu-ict-lab / boostcamp-7 / instructor                      | `beu-ict-lab-boostcamp-7-instructor-v0`                      | migrate (proposed) |
| `certificate-instructor-825`             | `templates/certificate/certificate-instructor-825.html` | BoostCamp 8.0                                       | A4 portrait            | same as above                                                                   | _pending_                  | beu-ict-lab / boostcamp-8 / instructor                      | `beu-ict-lab-boostcamp-8-instructor-v0`                      | migrate (proposed) |
| `certificate-distinct`                   | `templates/certificate/certificate-distinct.html`       | BoostCamp 7.0                                       | A4 portrait            | same; text "has exhibited outstanding performance in"                           | _pending_                  | beu-ict-lab / boostcamp-7 / distinction                     | `beu-ict-lab-boostcamp-7-distinction-v0`                     | migrate (proposed) |
| `certificate-distinct-825`               | `templates/certificate/certificate-distinct-825.html`   | BoostCamp 8.0                                       | A4 portrait            | same as above                                                                   | _pending_                  | beu-ict-lab / boostcamp-8 / distinction                     | `beu-ict-lab-boostcamp-8-distinction-v0`                     | migrate (proposed) |
| `certificate-team`                       | `templates/certificate/certificate-team.html`           | BoostCamp 7.0                                       | A4 portrait            | same; text "has contributed the organizer team as … in "BoostCamp 7.0" project" | _pending_                  | beu-ict-lab / boostcamp-7 / team                            | `beu-ict-lab-boostcamp-7-team-v0`                            | migrate (proposed) |
| `certificate-team-825`                   | `templates/certificate/certificate-team-825.html`       | BoostCamp 8.0                                       | A4 portrait            | same as above                                                                   | _pending_                  | beu-ict-lab / boostcamp-8 / team                            | `beu-ict-lab-boostcamp-8-team-v0`                            | migrate (proposed) |
| `conf-thanks`                            | `templates/certificate/conf-thanks.html`                | unknown conference (background uploaded 2024-04-26) | A4 landscape, margin 0 | fullName only                                                                   | _pending_                  | beu-ict-lab / _event unknown_ / thanks                      | _none yet_                                                   | pending decision   |
| `conf-ix-appreciation`                   | `conf-ix-appreciation.html` (repository root)           | IX Global Logistics Conference (May 2025)           | A4 landscape, margin 0 | fullName only                                                                   | _pending_                  | beu-ict-lab / ix-global-logistics-conference / appreciation | `beu-ict-lab-ix-global-logistics-conference-appreciation-v0` | migrate (proposed) |
| `conf-ix-attendance`                     | `conf-ix-attendance.html` (repository root)             | IX Global Logistics Conference                      | A4 landscape, margin 0 | fullName only                                                                   | _pending_                  | beu-ict-lab / ix-global-logistics-conference / attendance   | `beu-ict-lab-ix-global-logistics-conference-attendance-v0`   | migrate (proposed) |
| `conf-ix-thanks`                         | `conf-ix-thanks.html` (repository root)                 | IX Global Logistics Conference                      | A4 landscape, margin 0 | fullName only                                                                   | _pending_                  | beu-ict-lab / ix-global-logistics-conference / thanks       | `beu-ict-lab-ix-global-logistics-conference-thanks-v0`       | migrate (proposed) |

<!-- END INVENTORY -->

The `type` values come from the closed registry (`attendance`, `appreciation`, `thanks`, `distinction`, `instructor`, `student`, `team`, `other`); the mapping of the free-text `certificateType` to it is defined in #411. A reference is `<organization-slug>-<event-slug>-<type>-v<n>`; the first upload of each combination is `v0`.

### Differences between the BoostCamp templates (the four base files are one design)

| Template                 | Differences from `certificate-student`                                                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `certificate-instructor` | Text "has provided exceptional training in" and "class during …"; contains a leftover sample name `Huseyn Sharifzadeh` inside `th:text` (replaced at run time, no visual effect).                                                                                                                   |
| `certificate-distinct`   | Text "has exhibited outstanding performance in"; description width 65 % instead of 60 %; the heading paragraph has class `nameOfCertificate` (a typo for `name-of-certificate`, so it misses its own margin and width rules; the visible effect is small); the last line is not wrapped in a `<p>`. |
| `certificate-team`       | Text "has contributed the organizer team as" and the last line is only `in "BoostCamp N.0" project organized by BEU ICT Lab.` (no "lessons during <dates>").                                                                                                                                        |
| `*-825`                  | Edition change only (section 2, first paragraph).                                                                                                                                                                                                                                                   |

### Layout of the BoostCamp templates (A4 portrait, 595.28 × 841.89 pt)

Flow layout, not absolute positions, rendered by Flying Saucer. Sizes in CSS px (× 0.75 = pt): three or five logos 49 px wide (36.75 pt) with 13 px left margin in a header padded by 3 rem; edition name `h5` right-aligned, 26 px, colour `#059BDE`; heading (the certificate type) 50 px normal, `margin-top: 70px`; `fullName` 40 px, weight 600, `margin-top: 80px`; description lines 24 px, 60 % width; `activityName` 27 px bold; QR 75 px (56.25 pt) with `margin-top: 150px`; "Verify at: <URL>" in `#808080` at the bottom left; a decorative image `body-icon-2024.png`, 300 px (225 pt) wide, absolute at `right: 0; top: 50%` behind the text (`z-index: -1`). Because the layout is flow-based, the conversion tasks (#405-#408) must **measure the positions from a PDF rendered by the legacy system** (section 9, item 4), not compute them from the CSS.

### Layout of the conference templates (A4 landscape, 841.89 × 595.28 pt)

A full-width background image (`img { width: 99% }`, so a 1 % strip at the right edge shows the page colour) and a single centred `fullName`: `position: absolute; top: 49%; width: 100%`, 36 px (27 pt), bold, `"Times New Roman", serif`. `conf-thanks` additionally sets `body { background-color: rgba(0, 255, 255, 0.5) }` (cyan), which is visible in the 1 % strip; the three IX files do not. There are no other text elements: everything else (title, wording, signatures) is part of the background image.

## 3. Field mapping to the new template model

| Legacy                                                           | New                                     | Notes                                                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullName`                                                       | `fields.ownerName`                      | Direct.                                                                                                                                                                                 |
| `activityName` (`certificate.activity`)                          | `fields.subject`                        | Direct; free text.                                                                                                                                                                      |
| `certificateType` (heading, e.g. `CERTIFICATE OF PARTICIPATION`) | **decision D1**                         | The new `type` field prints the registry key (`attendance`, formatted), not an English heading. See below.                                                                              |
| literal text, dates, edition, logos, ornament                    | artwork (`background.svg`) and `images` | Fixed per template, so one new template per edition and type, which matches the proposed references.                                                                                    |
| `QR`                                                             | `qr`                                    | Legacy QR is 75 px (56.25 pt); new `qr.size` must be at least 40 pt (the renderer additionally needs 0.4 mm per module, about 47 pt for the production URL length). Use at least 56 pt. |
| `hashUrl` printed as text ("Verify at: <URL>")                   | not available                           | The URL is different on every certificate and cannot be baked into the artwork; only the QR code remains. Needs approval (**D3**).                                                      |
| `skills`, `issuedAt`                                             | not used by any legacy template         | Dates are literal text. The new templates may omit them; adding an `issuedAt` is possible but would change the look (**D4**).                                                           |

**D1: the certificate heading.** Legacy prints a different free-text heading per certificate with the same template (the sample data of the repository uses `CERTIFICATE OF APPRECIATION`, `…PARTICIPATION`, `…ACHIEVEMENT` and others with one template). The new engine has no per-certificate heading. Options: **(a, recommended)** bake the heading into the artwork per type (outlined text), and let #411 map each distinct legacy heading to the nearest registry `type`, listing certificates whose heading differs from the type's wording; **(b)** extend the engine with a type-to-label map (a code change, not in scope of E11). The list of distinct headings per template comes from the production query in section 9.

## 4. Organization and events (proposal, needs approval)

| Item                          | Proposal                                                                                                                                                                                                                                                                     | Status                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Organization                  | name `BEU ICT Lab`, slug `beu-ict-lab` (the legacy templates say "organized by BEU ICT Lab")                                                                                                                                                                                 | _pending_ confirmation |
| Event for `certificate-*`     | `BoostCamp 7.0` (`boostcamp-7`) and `BoostCamp 8.0` (`boostcamp-8`)                                                                                                                                                                                                          | _pending_              |
| Event for `conf-ix-*`         | `IX Global Logistics Conference` (`ix-global-logistics-conference`)                                                                                                                                                                                                          | _pending_              |
| Event for `conf-thanks`       | unknown                                                                                                                                                                                                                                                                      | _pending_              |
| Events from legacy `activity` | In legacy, `activity` is the free-text subject of each certificate (the sample data has job-like values such as `Engineer`), not an event. Event creation from distinct `activity` values is defined in #411; this inventory only fixes the events implied by the templates. | see #411               |

## 5. Images

The artwork used by the legacy HTML is hosted outside the repository. On 12 Nov 2026 every URL was unreachable (`ict.beu.edu.az` answered HTTP 522, the Cloudinary URL HTTP 401), so **sizes, pixel dimensions and licences could not be recorded**. Collect the originals (ideally SVG or high-resolution PNG, section 9, item 3).

| URL                                                                                      | Used by                              | Role                          | New handling                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------- | ---------------------------------------------------- |
| `https://ict.beu.edu.az/res/image/bc-7.0/beu-2024.png`                                   | `certificate-*` (7.0)                | logo, 49 px wide              | `images` (PNG, ≥ 300 DPI at 36.75 pt, i.e. ≥ 154 px) |
| `https://ict.beu.edu.az/res/image/bc-7.0/iria-2024.png`                                  | `certificate-*` (7.0)                | logo, 49 px wide              | same                                                 |
| `https://ict.beu.edu.az/res/image/bc-7.0/thik-2024.png`                                  | `certificate-*` (7.0)                | logo, 49 px wide              | same                                                 |
| `https://ict.beu.edu.az/res/image/bc-7.0/body-icon-2024.png`                             | all `certificate-*` including `-825` | decorative image, 300 px wide | `images` or recreate as SVG artwork                  |
| `https://ict.beu.edu.az/res/image/bc-8.0/ict-lab-2025.png`                               | `certificate-*-825`                  | logo, 49 px                   | `images`                                             |
| `https://ict.beu.edu.az/res/image/bc-8.0/beu-2025.png`                                   | `certificate-*-825`                  | logo, 49 px                   | `images`                                             |
| `https://ict.beu.edu.az/res/image/bc-8.0/aloha-world-2025.png`                           | `certificate-*-825`                  | logo, 49 px                   | `images`                                             |
| `https://ict.beu.edu.az/res/image/bc-8.0/cyber-army-2025.png`                            | `certificate-*-825`                  | logo, 49 px                   | `images`                                             |
| `https://ict.beu.edu.az/res/image/bc-8.0/data-lent-2025.png`                             | `certificate-*-825`                  | logo, 49 px                   | `images`                                             |
| `https://ict.beu.edu.az/res/image/conf-ix/conf-ix-appreciation.png`                      | `conf-ix-appreciation`               | full-page background          | see below                                            |
| `https://ict.beu.edu.az/res/image/conf-ix/conf-ix-attendance.png`                        | `conf-ix-attendance`                 | full-page background          | see below                                            |
| `https://ict.beu.edu.az/res/image/conf-ix/conf-ix-thanks.png`                            | `conf-ix-thanks`                     | full-page background          | see below                                            |
| `https://res.cloudinary.com/de1fywlwy/image/upload/v1714087426/xrkq2uiwvcvnviayqiim.png` | `conf-thanks`                        | full-page background          | see below                                            |

The new background must be an SVG without raster content (the validator rejects external references; inline `data:image/png` is allowed but the authoring guide recommends `images`). For the **four conference backgrounds**, which contain all text and ornament as one picture, there are three options: (1) the design owners supply the vector source, which is recreated as `background.svg` (preferred); (2) the PNG is placed as a full-page entry of `images` (`x: 0, y: 0, width: 841.89`) and `background.svg` is a plain white page: allowed (images are limited to 2 MiB and 4000 px per side, so a 300 DPI A4 page of 3508 × 2480 px may need JPEG/pngquant) but not editable; (3) trace the picture to SVG, which loses fidelity. The choice is recorded per template by #409 (the PNG option is a compromise and must be noted there).

Licences and copyright of the logos belong to their owners (BEU, IRIA, THIK, Aloha World, Cyber Army, Data Lent, BEU ICT Lab): written permission to redistribute them in the repository (the repository is private; the templates are stored in the private templates bucket) is _pending_ from the design owners and is a condition for #405-#409.

## 6. Fonts

Legacy font stacks: `"MS Gothic", Tahoma, sans-serif` (all templates) and `"Times New Roman", serif` for the conference `fullName`. All three are proprietary Microsoft fonts and cannot be redistributed. Replacements verified with the package validator's character set (the whole Azerbaijani alphabet and basic Cyrillic are present in each file; checked with `fontkit` on 12 Nov 2026):

| Legacy font                                                                                  | Replacement                                                                                                  | Version checked | Licence                                                                                                                                                                   | Coverage                            | Approval                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `Times New Roman` (conference name)                                                          | Liberation Serif Bold                                                                                        | 2.1.5           | SIL Open Font License 1.1 (Digitized data © 2010 Google Corporation with Reserved Font Arimo, Tinos and Cousine; © 2012 Red Hat, Inc. with Reserved Font Name Liberation) | Azerbaijani + Cyrillic: all present | _pending_ stakeholder approval of the look-alike |
| `Tahoma`, `sans-serif` (headings, descriptions)                                              | Noto Sans Regular and Bold                                                                                   | 2.004           | SIL OFL 1.1 (© Google Inc./LLC)                                                                                                                                           | all present                         | _pending_                                        |
| `MS Gothic` (first in the stack, most likely never available to the renderer, see section 1) | Noto Sans (as above); MS Gothic's Latin glyphs are a plain sans design, so no separate replacement is needed | 2.004           | SIL OFL 1.1                                                                                                                                                               | all present                         | _pending_                                        |

Fonts are shipped in each package under `fonts/` with the licence text in `fonts/LICENSE.txt`, exactly as in `docs/templates/reference/`. If the issued PDFs prove that another font was actually used (Helvetica or a DejaVu fallback), the replacement is chosen to match that font instead.

## 7. Migration scope and exclusions

A legacy `template` value found in production but missing from this inventory is an error of the validation script (see section 8). A template that no certificate uses is marked `not-migrated` with the justification in the mapping file once the counts are known. `conf-thanks` stays `pending` until its event is identified.

## 8. Mapping file and validation

`scripts/migration/template-mapping.json` holds the organization and, for each legacy template, either `status: "migrate"` (organization slug, event slug, `type`, expected `reference`), `"not-migrated"` or `"pending"` (both with a `reason`). The migration (#411) reads `templates[<certificate.template>]`.

```bash
npm run migration:validate-template-mapping
npm run migration:validate-template-mapping -- --production-templates template-counts.txt
```

The first form checks that mapping and inventory list the same templates, that every proposed reference matches the inventory row and is a valid reference for its organization, event and type (built with the same function the server uses), that references are unique and that exclusions have a reason. `pending` entries are listed but do not fail. The second form also fails when a value from the production query (one `template` per line, a trailing count is ignored) has neither a mapping nor an exclusion; run it once the production result is available.

## 9. Open items before the conversions (#405-#409) can start

1. **Production query** (read-only, on the legacy MySQL database), result saved as `template-counts.txt`; then fill the "Certificates in production" column and mark unused templates:

   ```sql
   SELECT template, COUNT(*) FROM certificate GROUP BY template ORDER BY template;
   SELECT template, certificate_type, COUNT(*) FROM certificate GROUP BY template, certificate_type ORDER BY template, 3 DESC;
   ```

   The second query lists the distinct headings per template (decision D1). Also run `SELECT COUNT(DISTINCT activity) FROM certificate;` for #411.

2. **Production template directory**: a listing of `./templates/certificate/` on the legacy server (file names, sizes, modification times) and a copy of any file that differs from the repository, because it is read from disk at run time.
3. **Original artwork** from the design owners: vector sources or the highest-resolution files of all logos, the decorative `body-icon`, and the four conference backgrounds, with written permission to redistribute (section 5).
4. **Reference PDFs rendered by the legacy system** for each template (one certificate with a long and a short name), to measure positions, take the real fonts and judge "visually equivalent" (positions within 2 mm) in the conversion tasks.
5. **Stakeholder approvals** (product owner): organization name and slug, events and their names, the look-alike fonts (section 6), decisions D1 (heading), D3 (printed URL dropped) and D4 (no date field), and the meaning of the `-825` suffix.
6. Identify the event of `conf-thanks`.

## 10. Acceptance status

- [x] Inventory with one row per template and a mapping file validated against it by a script.
- [ ] Reviewed and approved by the product owner.
- [ ] Every legacy `template` value found in production data has a mapping or documented exclusion (needs the production query, item 1).
- [ ] Original artwork collected (item 3).
