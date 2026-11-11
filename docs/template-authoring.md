# Template authoring guide

Azərbaycan dilində: [template-authoring.az.md](template-authoring.az.md).

A certificate template is a small **package** of files: an SVG artwork, a few fonts, optional logos and one `config.json` that says where the text and the QR code go. This guide takes you from a design file to an uploaded template. The package is rendered to PDF by the `svg-pdf` engine, so what you configure here is exactly what is printed.

Start from a working example: copy `docs/templates/reference/` (A4 landscape), `docs/templates/portrait/` or `docs/templates/minimal/` and change it. See [docs/templates/README.md](templates/README.md).

## 1. Package structure

```text
my-template/
├── config.json        required: layout and options
├── background.svg     required: artwork, A4, no live text
├── fonts/
│   └── Name.ttf       at least one TrueType font
└── assets/
    └── logo.png       optional PNG or JPEG images
```

Rules enforced on upload:

- Only these paths exist: `config.json`, `background.svg`, `fonts/<name>.ttf` and `assets/<name>.png|jpg|jpeg`. Names use letters, digits, `.`, `_`, `-`, at most 100 characters; two names that differ only by case are rejected.
- No subfolders other than `fonts/` and `assets/`, no links, no other file types.
- Limits are listed in [section 11](#11-limits).
- A licence file such as `fonts/LICENSE.txt` is welcome. The validator reports it as the warning `UNREFERENCED_FILE`; that is expected.

A package is **immutable** after upload. To change a design you upload a new version (section 9).

## 2. Coordinate system

All numbers in `config.json` are **PDF points** (1 pt = 1/72 inch = 0.3528 mm).

- A4 landscape is **841.89 × 595.28 pt**, A4 portrait is **595.28 × 841.89 pt**.
- The origin `(0, 0)` is the **top-left** corner of the page and **y grows downwards**.
- A text field is a box: `x`, `y` is its top-left corner, `width` is its width, its height is `maxLines × size × lineHeight`. Text wraps inside the box and the whole box must lie on the page.
- The QR code is a square with its top-left corner at `qr.x`, `qr.y` and the side `qr.size`.
- To convert: 1 mm = 2.835 pt, 1 cm = 28.35 pt, 1 px at 96 DPI = 0.75 pt.

## 3. Exporting the artwork (`background.svg`)

The background holds everything that is the same on every certificate: border, decoration, headings, labels, signatures. Names, dates and QR codes are drawn by the renderer on top.

Requirements:

1. **Page size.** The SVG `viewBox` must have the A4 aspect ratio of the configured orientation, ideally exactly `0 0 841.89 595.28` (landscape) or `0 0 595.28 841.89` (portrait). Between 1 % and 3 % deviation is a warning (`SVG_VIEWBOX_ASPECT`), above 3 % an error (`SVG_VIEWBOX_MISMATCH`). One viewBox unit equals one point.
2. **Convert text to outlines.** Fonts are not embedded in the SVG. A `<text>` element produces the warning `SVG_TEXT_ELEMENTS` and would print in a fallback font. Convert every heading and label to paths.
3. **No external references.** No `href`, `xlink:href` or `url(...)` pointing outside the document, no `@import`, no `<script>`, `<foreignObject>`, `<!DOCTYPE>` or `on…` attributes. Links to an element of the same file (`#gradient1`) and inline `data:image/png|jpeg;base64,` images are allowed, but put logos in `images` (below) instead of embedding them.
4. **Keep it light.** At most 5 MiB, nesting depth 64, 200,000 elements. Simplify paths and remove hidden layers, editor metadata and unused definitions.

### Inkscape

1. `File → Document Properties`: set **Display units** and **Custom size** units to `pt` (or `px` with scale 1.0), size `841.89 × 595.28`, **Scale x = 1.0**. Check in `Edit → XML Editor` that the root `<svg>` has `viewBox="0 0 841.89 595.28"`.
2. Select all text (`Edit → Select All in All Layers`), then `Path → Object to Path` (`Shift+Ctrl+C`). Do it for text inside groups, too.
3. Delete hidden layers and guide objects. `File → Clean Up Document` removes unused definitions.
4. `File → Save As… → Plain SVG` (not "Inkscape SVG"), so editor-specific metadata is dropped.
5. Open the file in a text editor and search for `<text` and `href`.

### Figma

1. Make a frame of **842 × 595** (landscape) or **595 × 842** (portrait). Figma pixels become points, a 0.3 pt rounding of the A4 size is fine (within the 1 % tolerance).
2. Select every text layer and use `Object → Flatten` (`Ctrl+E`), or right-click and `Outline stroke` / `Flatten`.
3. Do not place raster images in the frame; the logo goes into `images`.
4. Export the frame: format **SVG**, enable **Outline text**, disable **Include "id" attribute** and **Include bounding box**.
5. Check the result for `<text`, `<image` and `href`.

## 4. Logos and other images (`images`)

Raster images are placed by `config.json`, not by the SVG, so they stay sharp and are checked on upload.

- Formats: PNG (transparent background recommended) and JPEG. Each at most 2 MiB and 4000 px per side; at most 10 images.
- **Resolution.** The effective resolution is `pixel width ÷ printed width in inches`. Aim for about **300 DPI**: a logo printed **4 cm wide** (113.39 pt) needs about **470 px** (4 cm = 1.575 in × 300). Below 150 DPI (`IMAGE_LOW_RESOLUTION`) it looks blurry, above 600 DPI (`IMAGE_HIGH_RESOLUTION`) it only makes the file larger.
- Export from your design tool at exactly the width you need; do not scale up a small bitmap.
- **Optimise** before upload, losslessly: `oxipng -o 4 --strip safe logo.png`, or for flat-colour logos `pngquant --quality 80-95 --ext .png --force logo.png`. A logo of 20–60 KB is typical.
- `width` in `config.json` is the printed width in points, the height follows the aspect ratio. `x`, `y` is the top-left corner.

```json
"images": [{ "file": "assets/logo.png", "x": 364.25, "y": 48, "width": 113.39 }]
```

## 5. Fonts

- Format: **TrueType (`.ttf`)** in `fonts/`, one file per style (regular, bold, …), at most 8 fonts, each at most 3 MiB. Font collections (`.ttc`) and web fonts (`.woff`) are not accepted. Use static instances, not variable fonts.
- **Glyph coverage.** A font used by `ownerName` or `subject` must contain the whole Azerbaijani alphabet, digits and `.,-'’()/`. The critical letters are **`ə Ə ı İ ö ü ç ş ğ`**; a font lacking some is rejected with `FONT_MISSING_GLYPHS`. Basic Cyrillic is checked as well (`FONT_NO_CYRILLIC` warns), because names of participants may be written in it.
- **Licence.** Use only fonts whose licence permits embedding in PDFs **and redistribution** with your package, for example SIL OFL 1.1 or Apache 2.0 (Noto, Liberation, Open Sans, Roboto, Source Sans). Commercial fonts usually forbid it. Keep the licence text in `fonts/LICENSE.txt`.
- Check the glyphs before uploading: `fc-query --format '%{charset}\n' fonts/Name.ttf`, or just run the validator (section 8).
- In `config.json` each font gets a short key (letters, digits, `_`, `-`, at most 32 characters) and fields refer to that key:

```json
"fonts": { "title": "fonts/NotoSerif-Bold.ttf", "body": "fonts/NotoSans-Regular.ttf" }
```

## 6. Measuring field positions

1. In your design tool place a rectangle where the text should be, as wide as the longest line you accept. Name, subject, skills, date and type each get their own box.
2. Read its position and width in **points** (set the tool's unit to `pt`; with a 842 × 595 Figma frame, pixels are points). Inkscape shows the Y axis downwards from the top in 1.x; check with the page corner.
3. Set `x`, `y`, `width` from the rectangle. Choose `size` (point size of the text) and `maxLines`. The box height is `maxLines × size × lineHeight` (`lineHeight` defaults to 1.2): for `size: 36`, `maxLines: 2` it is 86.4 pt. Make sure the box stays on the page and does not overlap another box by more than 2 pt (QR code included), otherwise set `allowOverlap: true` on purpose.
4. **Long text wraps and shrinks.** The renderer uses the largest size, from `size` down to `minSize` in 0.5 pt steps (default `minSize` is `max(6, floor(size × 0.6))`), at which the text wraps into at most `maxLines` lines. A single word wider than the box is split only at `minSize`. If nothing fits, issuing fails with `TEXT_DOES_NOT_FIT`. Test the longest names you expect (section 9).
5. `align` aligns text inside the box; for centred text use a box that is symmetric around the page centre: `x = (pageWidth − width) / 2`.
6. Leave room for the QR code: size at least 40 pt in the schema, and big enough that each QR module prints at least 0.4 mm. Around 90–110 pt is comfortable. A QR code that is too small fails with `QR_TOO_SMALL`.

## 7. Config reference

`config.json` is strict: unknown keys are rejected everywhere. The machine-readable form is [template-config.schema.json](template-config.schema.json). The tables below are generated from the same schema the server uses (`npm run template-authoring:generate -w api`); do not edit them by hand.

### Top level

<!-- BEGIN GENERATED: config-reference -->

| Key                | Required | Type / allowed values                                                    | Description                                                   |
| ------------------ | -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `engine`           | yes      | `"svg-pdf"`                                                              |                                                               |
| `page`             | yes      | object                                                                   |                                                               |
| `page.size`        | yes      | `"A4"`                                                                   |                                                               |
| `page.orientation` | yes      | `"landscape"` \| `"portrait"`                                            |                                                               |
| `locale`           | no       | `"az"` \| `"en"`                                                         | Date formatting locale, default az.                           |
| `background`       | yes      | string, pattern `^([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\.svg$`, ≤ 100 chars |                                                               |
| `images`           | no       | array, ≤ 10 items                                                        |                                                               |
| `images[].file`    | yes      | string, pattern `^assets/[A-Za-z0-9._-]+\.(png\|jpe?g)$`, ≤ 100 chars    |                                                               |
| `images[].x`       | yes      | number, ≥ 0, ≤ 10000                                                     |                                                               |
| `images[].y`       | yes      | number, ≥ 0, ≤ 10000                                                     |                                                               |
| `images[].width`   | yes      | number, > 0, ≤ 10000                                                     | Printed width in points; the height follows the aspect ratio. |
| `fonts`            | yes      | object                                                                   |                                                               |
| `fonts.<name>`     | no       | string, pattern `^fonts/[A-Za-z0-9._-]+\.ttf$`, ≤ 100 chars              |                                                               |
| `fields`           | yes      | object                                                                   |                                                               |
| `qr`               | yes      | object                                                                   |                                                               |
| `qr.x`             | yes      | number, ≥ 0, ≤ 10000                                                     |                                                               |
| `qr.y`             | yes      | number, ≥ 0, ≤ 10000                                                     |                                                               |
| `qr.size`          | yes      | number, ≥ 40, ≤ 10000                                                    |                                                               |

<!-- END GENERATED: config-reference -->

### Field keys

`fields.ownerName` is required, the other fields are optional. Each field object uses the same keys:

<!-- BEGIN GENERATED: field-keys -->

Field names: `ownerName`, `subject`, `skills`, `issuedAt`, `type`.

| Key            | Required | Type / allowed values                                                                                                          | Description                                                                                                                                                                               |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x`            | yes      | number, ≥ 0, ≤ 10000                                                                                                           | Left edge of the box in points.                                                                                                                                                           |
| `y`            | yes      | number, ≥ 0, ≤ 10000                                                                                                           | Top edge of the box in points (y grows downwards).                                                                                                                                        |
| `width`        | yes      | number, > 0, ≤ 10000                                                                                                           | Box width in points; text wraps inside it.                                                                                                                                                |
| `font`         | yes      | string                                                                                                                         | Key of an entry in `fonts`.                                                                                                                                                               |
| `size`         | yes      | number, ≥ 6, ≤ 200                                                                                                             | Font size in points.                                                                                                                                                                      |
| `color`        | yes      | string, pattern `^#[0-9A-Fa-f]{6}$`                                                                                            |                                                                                                                                                                                           |
| `align`        | yes      | `"left"` \| `"center"` \| `"right"`                                                                                            |                                                                                                                                                                                           |
| `maxLines`     | yes      | integer, ≥ 1, ≤ 10                                                                                                             |                                                                                                                                                                                           |
| `format`       | no       | `"text"` \| `"uppercase"` \| `"lowercase"` \| `"titlecase"` \| `"date-dmy"` \| `"date-iso"` \| `"date-long"` \| `"list-comma"` | Formatter name. Defaults per field: `text` for ownerName, subject and type; `list-comma` for skills; `date-long` for issuedAt. `list-comma` only fits `skills`, `date-*` only `issuedAt`. |
| `minSize`      | no       | number, ≥ 6                                                                                                                    | Smallest font size the text may shrink to. Default max(6, floor(size * 0.6)) capped at size; must be between 6 and size.                                                                  |
| `lineHeight`   | no       | number, ≥ 1, ≤ 2                                                                                                               | Line height factor, default 1.2.                                                                                                                                                          |
| `allowOverlap` | no       | boolean                                                                                                                        | Allows this box to overlap another box by more than 2 pt (reported as a warning).                                                                                                         |

<!-- END GENERATED: field-keys -->

Example of the five fields (every key shown at least once):

```json
"fields": {
  "ownerName": { "x": 70.9, "y": 270, "width": 700, "font": "title", "size": 38, "color": "#1d3557", "align": "center", "maxLines": 1, "format": "text", "minSize": 22, "lineHeight": 1.2 },
  "subject":   { "x": 160.95, "y": 325, "width": 520, "font": "serif", "size": 20, "color": "#333333", "align": "center", "maxLines": 2, "format": "titlecase", "lineHeight": 1.25 },
  "skills":    { "x": 160.95, "y": 385, "width": 520, "font": "body", "size": 13, "color": "#555555", "align": "center", "maxLines": 2, "format": "list-comma" },
  "type":      { "x": 160.95, "y": 435, "width": 520, "font": "strong", "size": 12, "color": "#b8902f", "align": "center", "maxLines": 1, "format": "uppercase" },
  "issuedAt":  { "x": 70, "y": 512, "width": 230, "font": "body", "size": 13, "color": "#333333", "align": "left", "maxLines": 1, "format": "date-long" }
}
```

What each field prints: `ownerName` the participant's name; `subject` the event or course title; `skills` the list of skills (comma-separated by `list-comma`); `issuedAt` the issue date in the Baku time zone; `type` the certificate type (`attendance`, `appreciation`, `thanks`, `distinction`, `instructor`, `student`, `team`, `other`). An empty value is skipped without error.

### Formats

`format` turns the raw value into the printed text. `uppercase`, `lowercase` and `titlecase` follow Azerbaijani rules when the template `locale` is `az` (`i → İ`, `I → ı`); `date-long` uses the month names of the `locale`.

<!-- BEGIN GENERATED: formats -->

| Format       | Fits field               | Default for              | Example, locale `az`             | Example, locale `en`             |
| ------------ | ------------------------ | ------------------------ | -------------------------------- | -------------------------------- |
| `text`       | ownerName, subject, type | ownerName, subject, type | aysel məmmədova-əliyeva          | aysel məmmədova-əliyeva          |
| `uppercase`  | ownerName, subject, type |                          | AYSEL MƏMMƏDOVA-ƏLİYEVA          | AYSEL MƏMMƏDOVA-ƏLIYEVA          |
| `lowercase`  | ownerName, subject, type |                          | aysel məmmədova-əliyeva          | aysel məmmədova-əliyeva          |
| `titlecase`  | ownerName, subject, type |                          | Aysel Məmmədova-Əliyeva          | Aysel Məmmədova-Əliyeva          |
| `date-dmy`   | issuedAt                 |                          | 03.11.2026                       | 03.11.2026                       |
| `date-iso`   | issuedAt                 |                          | 2026-11-03                       | 2026-11-03                       |
| `date-long`  | issuedAt                 | issuedAt                 | 3 noyabr 2026                    | 3 November 2026                  |
| `list-comma` | skills                   | skills                   | TypeScript, Cloud Run, Firestore | TypeScript, Cloud Run, Firestore |

<!-- END GENERATED: formats -->

### Page, QR code and complete examples

```json
"page": { "size": "A4", "orientation": "landscape" },
"qr": { "x": 640, "y": 455, "size": 90 }
```

Complete packages: [`docs/templates/reference/config.json`](templates/reference/config.json) (every key), [`docs/templates/portrait/config.json`](templates/portrait/config.json) and [`docs/templates/minimal/config.json`](templates/minimal/config.json) (only `ownerName` and `qr`).

## 8. Validate offline

The same checks that run on upload are available as a command. From the repository root, after `npm ci`:

```bash
npm run template:validate -w api -- ../my-template
npm run template:validate -w api -- ../my-template --json
```

The path is relative to `api/`. Exit code `0` means the package is accepted (warnings allowed), `1` rejected, `2` wrong usage or unreadable directory. Each finding shows a code, the config path or file and a message; see the troubleshooting table in section 10. The command reads the folder only: no network, no symlinks.

## 9. Upload, preview and versions

1. **Upload.** In the admin app open `Templates → Upload template`, choose the organization, event and certificate type, then choose or drop the package folder (`config.json`, `background.svg`, `fonts/`, `assets/`). Problems are shown before and after the upload; warnings do not block it.
2. **Reference and version.** The server names the template `<organization-slug>-<event-slug>-<type>-v<n>` (for example `acme-devfest-attendance-v0`). The first upload of an organization, event and type is `v0`, every further upload is the next number. You never choose the number, and a published version is never changed or deleted by uploading.
3. **New version.** To fix a design, upload the corrected package as a new version of the same organization, event and type (`New version` on the template page, or `Copy to another event` to reuse it elsewhere). Certificates already issued keep the version they were issued with.
4. **Preview.** The template page offers `Preview`: it renders a sample certificate (`POST /api/v1/admin/templates/{reference}/preview`) with a typical and a longest-text preset (120-character name, 200-character subject, 10 skills of 40 characters). A text that cannot fit is reported with the field name instead of producing a PDF. Always preview both presets, and a name with `ə İ ı ş ğ`.

## 10. Troubleshooting validator codes

Errors reject the upload, warnings do not. The `path` in a finding is a config path such as `fields.subject.font` or `images[0].file`.

| Code                                                                                                                      | Level                    | Meaning and fix                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEMPLATE_INVALID`                                                                                                        | error                    | HTTP 422 wrapper; `details[]` lists every finding below. Fix them all and upload again.                                                                                                                                       |
| `TOO_MANY_FILES`                                                                                                          | error                    | More than 30 files. Remove unused files.                                                                                                                                                                                      |
| `PACKAGE_TOO_LARGE`                                                                                                       | error                    | More than 10 MiB in total. Optimise images, subset or drop unused fonts.                                                                                                                                                      |
| `FILE_TOO_LARGE`                                                                                                          | error                    | One file is over its limit (background 5 MiB, image 2 MiB, font 3 MiB). Optimise it.                                                                                                                                          |
| `FILENAME_INVALID`                                                                                                        | error                    | The file name has characters other than letters, digits, `.`, `_`, `-`, `/`, is longer than 100 characters or has a path problem. Rename it.                                                                                  |
| `FILENAME_CONTROL_CHARACTERS`                                                                                             | error                    | The file name contains control characters. Rename it.                                                                                                                                                                         |
| `FILENAME_DUPLICATE_CASE`                                                                                                 | error                    | Two files differ only by upper/lower case. Rename one.                                                                                                                                                                        |
| `FILENAME_UNSUPPORTED`                                                                                                    | error                    | The path is not `background.svg`, `fonts/<name>.ttf` or `assets/<name>.png                                                                                                                                                    | jpg | jpeg`. Move or rename the file. |
| `FILE_NOT_FOUND`                                                                                                          | error                    | `config.json` refers to a file that is not in the package. Check the spelling and the folder (`fonts/`, `assets/`).                                                                                                           |
| `UNREFERENCED_FILE`                                                                                                       | warning                  | A file is not used by `config.json` (a licence file is fine). Remove it if it is not needed.                                                                                                                                  |
| `SVG_NOT_XML`                                                                                                             | error                    | `background.svg` is not valid XML. Re-export it as plain SVG.                                                                                                                                                                 |
| `SVG_ROOT_NOT_SVG`                                                                                                        | error                    | The root element is not `<svg>`.                                                                                                                                                                                              |
| `SVG_TOO_COMPLEX`                                                                                                         | error                    | Too deep (64), too many elements (200,000) or attributes (100 per element). Simplify the artwork.                                                                                                                             |
| `SVG_DOCTYPE`                                                                                                             | error                    | The file has `<!DOCTYPE` or `<!ENTITY`. Remove it; save as plain SVG.                                                                                                                                                         |
| `SVG_PROCESSING_INSTRUCTION`                                                                                              | error                    | The file has an XML processing instruction other than the XML declaration (for example a stylesheet). Remove it.                                                                                                              |
| `SVG_SCRIPT`                                                                                                              | error                    | `<script>` is not allowed. Remove it.                                                                                                                                                                                         |
| `SVG_FOREIGN_OBJECT`                                                                                                      | error                    | `<foreignObject>` is not allowed. Convert its content to shapes.                                                                                                                                                              |
| `SVG_EVENT_HANDLER`                                                                                                       | error                    | An `on…` attribute (`onclick`, `onload`…) was found. Remove it.                                                                                                                                                               |
| `SVG_EXTERNAL_REFERENCE`                                                                                                  | error                    | An `href` or `url(...)` points outside the document. Embed the shape or move the picture to `images`.                                                                                                                         |
| `SVG_CSS_IMPORT`                                                                                                          | error                    | CSS `@import` is not allowed. Inline the styles.                                                                                                                                                                              |
| `SVG_CSS_ESCAPE`                                                                                                          | error                    | A style or `url(...)` value contains a backslash escape, which could hide a forbidden construct. Remove the backslash.                                                                                                        |
| `SVG_NO_VIEWBOX`                                                                                                          | error                    | The root `<svg>` has no `viewBox`. Add `viewBox="0 0 841.89 595.28"`.                                                                                                                                                         |
| `SVG_VIEWBOX_MISMATCH`                                                                                                    | error                    | The viewBox aspect ratio differs from the page by more than 3 %. Resize the artboard to A4 and the right orientation.                                                                                                         |
| `SVG_VIEWBOX_ASPECT`                                                                                                      | warning                  | The aspect ratio is 1–3 % off the page. Prefer the exact A4 size.                                                                                                                                                             |
| `SVG_TEXT_ELEMENTS`                                                                                                       | warning                  | The SVG contains `<text>`; it would print in a fallback font. Convert text to outlines.                                                                                                                                       |
| `IMAGE_CORRUPT`                                                                                                           | error                    | The image is not a valid PNG or JPEG. Export it again.                                                                                                                                                                        |
| `IMAGE_TYPE_MISMATCH`                                                                                                     | error                    | The extension disagrees with the content (a PNG named `.jpg`). Fix the extension.                                                                                                                                             |
| `IMAGE_TOO_LARGE_DIMENSIONS`                                                                                              | error                    | An image side is over 4000 px. Resize it.                                                                                                                                                                                     |
| `IMAGE_LOW_RESOLUTION`                                                                                                    | warning                  | Below 150 DPI at the printed `width`. Export a larger bitmap or print it smaller.                                                                                                                                             |
| `IMAGE_HIGH_RESOLUTION`                                                                                                   | warning                  | Above 600 DPI. Downscale to about 300 DPI.                                                                                                                                                                                    |
| `FONT_INVALID`                                                                                                            | error                    | Not a single TrueType font (empty, corrupt or a collection). Use a static `.ttf`.                                                                                                                                             |
| `FONT_MISSING_GLYPHS`                                                                                                     | error                    | A font used by `ownerName` or `subject` lacks Azerbaijani letters, digits or punctuation. Choose another font (section 5).                                                                                                    |
| `FONT_NO_CYRILLIC`                                                                                                        | warning                  | That font has no basic Cyrillic. Names in Cyrillic would not print.                                                                                                                                                           |
| `FONT_NOT_DEFINED`                                                                                                        | error                    | A field's `font` is not a key of `fonts`. Check the spelling.                                                                                                                                                                 |
| `FORMAT_NOT_APPLICABLE`                                                                                                   | error                    | The `format` does not fit the field (`list-comma` only for `skills`, `date-*` only for `issuedAt`).                                                                                                                           |
| `OUT_OF_BOUNDS`                                                                                                           | error                    | A field box or the QR code leaves the page (right edge or, with height `maxLines × size × lineHeight`, bottom edge). Move it or make it smaller.                                                                              |
| `BOXES_OVERLAP`                                                                                                           | error / warning          | Two boxes (QR included) overlap by more than 2 pt. Move one, or set `allowOverlap: true` to turn the error into a warning.                                                                                                    |
| `unrecognized_keys`, `invalid_type`, `required`, `invalid_value`, `too_small`, `too_big`, `invalid_format`, `invalid_key` | error                    | Schema errors of `config.json`: an unknown key, a wrong type or value, a missing required key, a value outside its range, a malformed pattern (for example colour `#RRGGBB`). The path names the key; compare with section 7. |
| `TEXT_DOES_NOT_FIT`                                                                                                       | error (preview, issuing) | The text does not fit its box even at `minSize` on `maxLines` lines. Widen the box, allow more lines, lower `minSize` or shorten the text.                                                                                    |
| `QR_TOO_SMALL`                                                                                                            | error (preview, issuing) | The QR modules would print under 0.4 mm. Increase `qr.size`.                                                                                                                                                                  |
| `RENDER_ENGINE_UNSUPPORTED`                                                                                               | error                    | `engine` names an engine this server does not have. Use `svg-pdf`.                                                                                                                                                            |
| `RENDER_TOO_LARGE`                                                                                                        | error                    | The rendered PDF exceeds 2 MB, usually because of an unoptimised image. Optimise or downscale it (section 4).                                                                                                                 |

## 11. Limits

<!-- BEGIN GENERATED: limits -->

| Limit                                                         | Value              |
| ------------------------------------------------------------- | ------------------ |
| Files in a package                                            | 30                 |
| Package size                                                  | 10 MiB             |
| `background.svg` size                                         | 5 MiB              |
| Image size                                                    | 2 MiB              |
| Image side                                                    | 4000 px            |
| Font file size                                                | 3 MiB              |
| Effective logo resolution (warning outside)                   | 150 – 600 DPI      |
| SVG parser limits (depth / elements / attributes per element) | 64 / 200,000 / 100 |

<!-- END GENERATED: limits -->

## 12. Checklist for visual parity

Use it when you convert an existing design or hand a template to someone for approval.

- [ ] Page size and orientation match the original print (A4 landscape or portrait).
- [ ] Artwork exported with all text as outlines; the file has no `<text`, `<image` or `href` (`grep -c '<text\|<image\|href' background.svg` prints `0`).
- [ ] Every field is at the position of the original (compare an overlay of the rendered PDF and the original at 100 %).
- [ ] Font, size, colour and alignment match the original; the font licence allows redistribution.
- [ ] The longest realistic name and subject fit (preview preset `longest`), and a short name looks right.
- [ ] A name with `ə İ ı ö ü ç ş ğ` and one in Cyrillic print correctly.
- [ ] `format` and `locale` give the right casing and date (`3 noyabr 2026`, `03.11.2026`, `2026-11-03`).
- [ ] The QR code is at least 0.4 mm per module, is not covered by artwork and scans from the printed page.
- [ ] Logo is about 300 DPI and optimised; no file is unused (except the licence).
- [ ] `npm run template:validate -w api -- <dir>` reports no errors.
- [ ] Preview looks right in a PDF viewer and printed on paper.
