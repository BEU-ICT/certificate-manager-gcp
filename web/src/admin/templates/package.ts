/**
 * Template package handling for the upload form: maps picked or dropped files to package paths and
 * runs fast pre-checks that mirror the server limits (`api/src/http/multipart/template-upload.ts`,
 * `api/src/modules/templates/README.md`). The server stays authoritative.
 */

const MIB = 1024 * 1024;

export const PACKAGE_LIMITS = {
  /** Package files besides `config.json`. */
  maxFiles: 30,
  /** Sum of the package file sizes (config included). */
  maxTotalBytes: 10 * MIB,
  maxPartBytes: 5 * MIB,
  maxFontBytes: 3 * MIB,
  maxPathLength: 100,
} as const;

export interface PackageEntry {
  /** Relative package path, folder prefix stripped (`fonts/Inter.ttf`). */
  path: string;
  file: File;
}

/** A pre-check finding. `key` is an `admin:templates.uploadForm.check.*` i18n key. */
export interface PackageIssue {
  severity: 'error' | 'warning';
  key: string;
  params?: Record<string, string | number>;
  /** File or config path the finding belongs to; `''` for package-wide findings. */
  path: string;
}

const IGNORED = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
/** Storage layout: `background.svg`, `fonts/<name>.ttf`, `assets/<name>.png|jpg|jpeg`. */
const LAYOUT = /^(background\.svg|fonts\/[^/]+\.ttf|assets\/[^/]+\.(png|jpe?g))$/i;
/** A walk stops after this many files; the file-count check reports the overflow. */
const WALK_LIMIT = PACKAGE_LIMITS.maxFiles + 20;
const SKIPPED_DIRECTORIES = new Set(['node_modules']);

function isIgnored(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return IGNORED.has(name) || name.startsWith('._');
}

/**
 * Maps picked files to package paths. Files from a folder picker carry `webkitRelativePath`
 * (`my-template/fonts/a.ttf`): the first segment is the folder itself and is stripped. Loose files
 * use their name.
 */
export function mapPickedFiles(files: readonly File[]): PackageEntry[] {
  const entries: PackageEntry[] = [];
  for (const file of files) {
    const relative = file.webkitRelativePath;
    const path = relative ? relative.split('/').slice(1).join('/') : file.name;
    if (path !== '' && !isIgnored(path)) entries.push({ path, file });
  }
  return entries;
}

/** Subset of the (non-standard) FileSystem Entry API used for dropped folders. */
export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, failure?: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: FsEntry[]) => void,
      failure?: (error: unknown) => void,
    ) => void;
  };
}

async function readDirectory(entry: FsEntry): Promise<FsEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const all: FsEntry[] = [];
  // readEntries returns at most ~100 entries per call: read until it returns an empty batch.
  for (;;) {
    const batch = await new Promise<FsEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walk(entry: FsEntry, prefix: string, out: PackageEntry[]): Promise<void> {
  if (out.length >= WALK_LIMIT) return;
  if (entry.isFile && entry.file) {
    const read = entry.file;
    const file = await new Promise<File>((resolve, reject) => {
      read.call(entry, resolve, reject);
    });
    const path = prefix + entry.name;
    if (!isIgnored(path)) out.push({ path, file });
  } else if (
    entry.isDirectory &&
    !entry.name.startsWith('.') &&
    !SKIPPED_DIRECTORIES.has(entry.name)
  ) {
    for (const child of await readDirectory(entry)) {
      await walk(child, `${prefix}${entry.name}/`, out);
    }
  }
}

/**
 * Entries of a drop. A single dropped folder is the package root (its name is stripped); anything
 * else (files, several folders) is mapped relative to the drop.
 */
export async function entriesFromDrop(dataTransfer: DataTransfer): Promise<PackageEntry[]> {
  const roots: FsEntry[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }
    ).webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  if (roots.length === 0) return mapPickedFiles(Array.from(dataTransfer.files));
  const out: PackageEntry[] = [];
  const [only] = roots;
  if (roots.length === 1 && only?.isDirectory) {
    for (const child of await readDirectory(only)) await walk(child, '', out);
  } else {
    for (const root of roots) await walk(root, '', out);
  }
  return out;
}

export function totalBytes(entries: readonly PackageEntry[]): number {
  return entries.reduce((sum, e) => sum + e.file.size, 0);
}

export type ConfigState =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'tooLarge' }
  | { status: 'ok'; value: unknown };

/** Reads and parses `config.json` of the selection (it is small: the server caps it at 5 MB). */
export async function readConfig(entries: readonly PackageEntry[]): Promise<ConfigState> {
  const config = entries.find((e) => e.path === 'config.json');
  if (!config) return { status: 'missing' };
  // Same cap as the server's per-part limit; never read a huge file into memory.
  if (config.file.size > PACKAGE_LIMITS.maxPartBytes) return { status: 'tooLarge' };
  try {
    return { status: 'ok', value: JSON.parse(await config.file.text()) as unknown };
  } catch {
    return { status: 'invalid' };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Files the config references, with their config path (same paths as the server reports). */
export function referencedFiles(config: unknown): { path: string; file: string }[] {
  if (!isRecord(config)) return [];
  const refs: { path: string; file: string }[] = [];
  if (typeof config['background'] === 'string') {
    refs.push({ path: 'background', file: config['background'] });
  }
  if (Array.isArray(config['images'])) {
    (config['images'] as unknown[]).forEach((image, index) => {
      if (isRecord(image) && typeof image['file'] === 'string') {
        refs.push({ path: `images[${String(index)}].file`, file: image['file'] });
      }
    });
  }
  if (isRecord(config['fonts'])) {
    for (const [name, file] of Object.entries(config['fonts'])) {
      if (typeof file === 'string') refs.push({ path: `fonts.${name}`, file });
    }
  }
  return refs;
}

/** Pre-checks of a selection. Errors block the upload; warnings are advisory. */
export function precheck(entries: readonly PackageEntry[], config: ConfigState): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const error = (key: string, path = '', params?: Record<string, string | number>) =>
    issues.push({ severity: 'error', key, path, ...(params ? { params } : {}) });

  if (entries.length === 0) return issues;
  const files = entries.filter((e) => e.path !== 'config.json');

  if (config.status === 'missing') error('configMissing');
  if (config.status === 'invalid') error('configInvalid', 'config.json');
  if (files.length > PACKAGE_LIMITS.maxFiles) {
    error('tooManyFiles', '', { count: files.length, max: PACKAGE_LIMITS.maxFiles });
  }
  if (totalBytes(entries) > PACKAGE_LIMITS.maxTotalBytes) error('totalTooLarge');

  const seen = new Set<string>();
  for (const { path, file } of entries) {
    const lower = path.toLowerCase();
    if (seen.has(lower)) error('duplicate', path);
    seen.add(lower);
    if (
      path.length > PACKAGE_LIMITS.maxPathLength ||
      !SAFE_PATH.test(path) ||
      path.includes('..')
    ) {
      error('badName', path);
      continue;
    }
    if (path !== 'config.json' && !LAYOUT.test(path)) {
      error('layout', path);
      continue;
    }
    const cap = path.startsWith('fonts/')
      ? PACKAGE_LIMITS.maxFontBytes
      : PACKAGE_LIMITS.maxPartBytes;
    if (file.size > cap) error('fileTooLarge', path, { max: cap / MIB });
  }

  if (config.status === 'ok') {
    for (const ref of referencedFiles(config.value)) {
      if (!files.some((e) => e.path === ref.file)) {
        error('referencedMissing', ref.path, { file: ref.file });
      }
    }
  }
  return issues;
}
