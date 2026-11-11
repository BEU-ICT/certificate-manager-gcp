# Reference template packages

Three complete, validated template packages (see `api/test/unit/reference-templates.test.ts`). They are the fixtures for rendering golden tests, the dev seed and the starting point for converting legacy templates.

| Package      | Page         | Shows                                                                                                                                                                     |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reference/` | A4 landscape | Every config key and field: `locale`, `images`, four fonts, `ownerName`, `subject`, `skills`, `type`, `issuedAt`, `format`, `minSize`, `lineHeight`, `allowOverlap`, `qr` |
| `portrait/`  | A4 portrait  | The same design in portrait: wrapped (2-line) names, `uppercase`, `lowercase`, `date-dmy`, `locale: en`                                                                   |
| `minimal/`   | A4 landscape | The smallest valid package: no images, one font, only `ownerName` and `qr`                                                                                                |

Each package contains `config.json`, `background.svg`, `fonts/` (with `LICENSE.txt`), optionally `assets/logo.png`, and `golden.png`, the expected raster (1 px per point) of the sample certificate. `golden.png` is a test artefact and is **not** part of a package: do not upload it.

Not every formatter can appear in one package (a field has a single `format`); the test checks all eight (`text`, `uppercase`, `lowercase`, `titlecase`, `date-dmy`, `date-iso`, `date-long`, `list-comma`) against the validator.

## Validate and render

```bash
npm run template:validate -w api -- ../docs/templates/reference
```

The validator reports one warning, `UNREFERENCED_FILE fonts/LICENSE.txt`: the licence text must travel with the fonts but no config key references it. Delete it only when you replace the fonts with ones whose licence does not require it.

When artwork, config or the renderer change on purpose, regenerate the goldens and review the images:

```bash
UPDATE_GOLDEN=1 npx vitest run test/unit/reference-templates.test.ts -w api
```

## Licences

| Asset                                                                                            | Licence                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `fonts/NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`, `NotoSerif-Regular.ttf`, `NotoSerif-Bold.ttf` | SIL Open Font License 1.1, copyright Google Inc./LLC (Noto project, https://github.com/notofonts/noto-fonts); text in each `fonts/LICENSE.txt` |
| `background.svg` (border, ornaments, outlined lettering)                                         | Original artwork for this repository, released under CC0 1.0; the lettering paths are outlines of Noto Serif Bold / Noto Sans (OFL 1.1)        |
| `assets/logo.png`                                                                                | Original placeholder emblem, CC0 1.0; it is not a BEU or event logo                                                                            |

The OFL permits redistribution and embedding in documents; the fonts are not sold on their own.
