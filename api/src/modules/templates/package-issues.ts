/** One finding of the package validator. `path` is the config path when there is one, else the file. */
export interface Issue {
  /** Stable machine-readable code, e.g. `SVG_SCRIPT`, `FONT_MISSING_GLYPHS`. */
  code: string;
  path: string;
  /** Package path of the offending file, when the finding belongs to one. */
  file?: string;
  message: string;
}

export interface ValidationReport {
  /** The upload is rejected when this is not empty. */
  errors: Issue[];
  warnings: Issue[];
}

/** Hard limits of a template package (BEU-ICT/certificate-manager-gcp#86). */
export const PACKAGE_LIMITS = {
  maxFiles: 30,
  maxTotalBytes: 10 * 1024 * 1024,
  maxBackgroundBytes: 5 * 1024 * 1024,
  maxImageBytes: 2 * 1024 * 1024,
  maxImageSidePx: 4000,
  maxFontBytes: 3 * 1024 * 1024,
  /** Parser limits for the SVG (bounded memory and work on hostile input). */
  maxSvgDepth: 64,
  maxSvgNodes: 200_000,
  maxSvgAttributes: 100,
} as const;

/** Effective printed resolution window for raster images. */
export const MIN_IMAGE_DPI = 150;
export const MAX_IMAGE_DPI = 600;

/** Relative aspect-ratio difference up to which a viewBox is accepted silently / with a warning. */
export const VIEWBOX_OK_TOLERANCE = 0.01;
export const VIEWBOX_WARN_TOLERANCE = 0.03;
