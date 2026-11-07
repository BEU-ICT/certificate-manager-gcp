import { pageDimensions, type TemplateConfig } from './config.js';
import { CYRILLIC_CHARACTERS, REQUIRED_CHARACTERS, openFont } from './package-fonts.js';
import { kindFromExtension, readImageHeader, sniffImage } from './package-images.js';
import {
  MAX_IMAGE_DPI,
  MIN_IMAGE_DPI,
  PACKAGE_LIMITS,
  type Issue,
  type ValidationReport,
} from './package-issues.js';
import { checkSvg } from './package-svg.js';
import { packagePathProblem } from './paths.js';

/** The config file inside a package; it is part of the package but needs no other file check. */
export const CONFIG_FILE = 'config.json';

// eslint-disable-next-line no-control-regex -- the point is to find control characters
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const mib = (bytes: number): string => `${String(Math.round((bytes / 1024 / 1024) * 10) / 10)} MB`;

/**
 * Validates an untrusted template package: size limits, file names, `background.svg`, images and
 * fonts (BEU-ICT/certificate-manager-gcp#86). Pure: no I/O and no network; it only inspects the
 * given bytes, checking sizes before it parses anything. `files` maps package-relative paths to
 * contents and `config` is the already parsed config (see `parseTemplateConfig`). The upload is
 * rejected when `errors` is not empty.
 */
export function validateTemplatePackage(
  files: ReadonlyMap<string, Buffer>,
  config: TemplateConfig,
): ValidationReport {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const error = (code: string, path: string, message: string, file?: string): void => {
    errors.push(file === undefined ? { code, path, message } : { code, path, file, message });
  };
  const warn = (code: string, path: string, message: string, file?: string): void => {
    warnings.push(file === undefined ? { code, path, message } : { code, path, file, message });
  };

  // 1. Package-wide limits, before any content is touched.
  let total = 0;
  for (const bytes of files.values()) total += bytes.length;
  if (files.size > PACKAGE_LIMITS.maxFiles) {
    error(
      'TOO_MANY_FILES',
      '',
      `Package has ${String(files.size)} files; at most ${String(PACKAGE_LIMITS.maxFiles)}`,
    );
  }
  if (total > PACKAGE_LIMITS.maxTotalBytes) {
    error(
      'PACKAGE_TOO_LARGE',
      '',
      `Package is ${mib(total)}; at most ${mib(PACKAGE_LIMITS.maxTotalBytes)}`,
    );
  }
  if (errors.length > 0) return { errors, warnings };

  // 2. File names.
  const seenLower = new Map<string, string>();
  for (const name of files.keys()) {
    if (CONTROL_CHARACTERS.test(name)) {
      error(
        'FILENAME_CONTROL_CHARACTERS',
        name.replace(CONTROL_CHARACTERS, '?'),
        'File name contains control characters',
      );
      continue;
    }
    const problem = packagePathProblem(name);
    if (problem !== undefined) error('FILENAME_INVALID', name.slice(0, 100), problem);
    const lower = name.toLowerCase();
    const earlier = seenLower.get(lower);
    if (earlier === undefined) seenLower.set(lower, name);
    else error('FILENAME_DUPLICATE_CASE', name, `Differs only in case from "${earlier}"`);
  }

  // 3. Referenced files.
  const referenced = new Map<string, string>();
  referenced.set(config.background, 'background');
  config.images.forEach((image, index) =>
    referenced.set(image.file, `images[${String(index)}].file`),
  );
  for (const [key, file] of Object.entries(config.fonts)) referenced.set(file, `fonts.${key}`);
  for (const [file, path] of referenced) {
    if (!files.has(file))
      error('FILE_NOT_FOUND', path, `File "${file}" is not part of the package`, file);
  }
  for (const name of files.keys()) {
    if (name !== CONFIG_FILE && !referenced.has(name) && !CONTROL_CHARACTERS.test(name)) {
      warn('UNREFERENCED_FILE', name.slice(0, 100), 'File is not referenced by config.json');
    }
  }

  // 4. Background.
  const background = files.get(config.background);
  if (background !== undefined) {
    if (background.length > PACKAGE_LIMITS.maxBackgroundBytes) {
      error(
        'FILE_TOO_LARGE',
        'background',
        `Background is ${mib(background.length)}; at most ${mib(PACKAGE_LIMITS.maxBackgroundBytes)}`,
        config.background,
      );
    } else {
      const result = checkSvg(background, pageDimensions(config.page));
      for (const issue of result.errors)
        error(issue.code, 'background', issue.message, config.background);
      for (const issue of result.warnings)
        warn(issue.code, 'background', issue.message, config.background);
    }
  }

  // 5. Images.
  config.images.forEach((image, index) => {
    const bytes = files.get(image.file);
    if (bytes === undefined) return;
    const path = `images[${String(index)}].file`;
    if (bytes.length > PACKAGE_LIMITS.maxImageBytes) {
      error(
        'FILE_TOO_LARGE',
        path,
        `Image is ${mib(bytes.length)}; at most ${mib(PACKAGE_LIMITS.maxImageBytes)}`,
        image.file,
      );
      return;
    }
    const actual = sniffImage(bytes);
    if (actual === undefined) {
      error(
        'IMAGE_CORRUPT',
        path,
        'File is neither a PNG nor a JPEG image (checked magic bytes)',
        image.file,
      );
      return;
    }
    const expected = kindFromExtension(image.file);
    if (expected !== actual) {
      error(
        'IMAGE_TYPE_MISMATCH',
        path,
        `Extension says ${String(expected)} but the content is ${actual}`,
        image.file,
      );
      return;
    }
    const header = readImageHeader(bytes);
    if (header === undefined || header.width < 1 || header.height < 1) {
      error('IMAGE_CORRUPT', path, 'Image header is truncated or invalid', image.file);
      return;
    }
    const max = PACKAGE_LIMITS.maxImageSidePx;
    if (header.width > max || header.height > max) {
      error(
        'IMAGE_TOO_LARGE_DIMENSIONS',
        path,
        `Image is ${String(header.width)}x${String(header.height)} px; at most ${String(max)} px per side`,
        image.file,
      );
      return;
    }
    const dpi = Math.round((header.width * 72) / image.width);
    if (dpi < MIN_IMAGE_DPI) {
      warn(
        'IMAGE_LOW_RESOLUTION',
        path,
        `About ${String(dpi)} DPI at the printed width of ${String(image.width)} pt; at least ${String(MIN_IMAGE_DPI)} recommended`,
        image.file,
      );
    } else if (dpi > MAX_IMAGE_DPI) {
      warn(
        'IMAGE_HIGH_RESOLUTION',
        path,
        `About ${String(dpi)} DPI at the printed width of ${String(image.width)} pt; above ${String(MAX_IMAGE_DPI)} only bloats the file`,
        image.file,
      );
    }
  });

  // 6. Fonts. The glyph coverage rules apply to the fonts used by ownerName and subject.
  const textFonts = new Set<string>();
  for (const name of ['ownerName', 'subject'] as const) {
    const font = config.fields[name]?.font;
    if (font !== undefined) textFonts.add(font);
  }
  for (const [key, file] of Object.entries(config.fonts)) {
    const bytes = files.get(file);
    if (bytes === undefined) continue;
    const path = `fonts.${key}`;
    if (bytes.length > PACKAGE_LIMITS.maxFontBytes) {
      error(
        'FILE_TOO_LARGE',
        path,
        `Font is ${mib(bytes.length)}; at most ${mib(PACKAGE_LIMITS.maxFontBytes)}`,
        file,
      );
      continue;
    }
    const font = openFont(bytes);
    if (!font.ok) {
      error('FONT_INVALID', path, font.reason, file);
      continue;
    }
    if (!textFonts.has(key)) continue;
    const missing = font.has(REQUIRED_CHARACTERS);
    if (missing.length > 0) {
      error(
        'FONT_MISSING_GLYPHS',
        path,
        `Font "${key}" lacks glyphs for: ${missing.slice(0, 20).join(' ')}${missing.length > 20 ? ' ...' : ''}`,
        file,
      );
    }
    const missingCyrillic = font.has(CYRILLIC_CHARACTERS);
    if (missingCyrillic.length > 0) {
      warn(
        'FONT_NO_CYRILLIC',
        path,
        `Font "${key}" lacks ${String(missingCyrillic.length)} basic Cyrillic glyphs`,
        file,
      );
    }
  }

  return { errors, warnings };
}
