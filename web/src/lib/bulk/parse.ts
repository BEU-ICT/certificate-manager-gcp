import {
  compareDays,
  formatIsoDate,
  fromDate,
  fromSerial,
  localToday,
  parseDateText,
} from './dates';
import { detectDelimiter, parseCsv } from './csv';
import { COLUMN_IDS, matchHeader, type ColumnId } from './headers';
import { MAX_COLUMNS, MAX_DATA_ROWS, MAX_FILE_BYTES, MAX_UNCOMPRESSED_BYTES } from './limits';
import {
  FIELD_LIMITS,
  optionalEmailSchema,
  ownerNameSchema,
  skillsSchema,
  subjectSchema,
  normalizeText,
  type RowErrorCode,
} from './schemas';
import type {
  BlockingError,
  Notice,
  ParseOptions,
  ParseOutcome,
  ParsedRow,
  RowError,
  RowValues,
} from './types';
import { unzipSync } from 'fflate';
import type { ZodType } from 'zod';

type Cell = unknown;

const blocked = (code: BlockingError['code'], limit?: number): ParseOutcome => ({
  ok: false,
  error: limit === undefined ? { code } : { code, limit },
});

/** Checks that need only the name and size, so they run before the file is read. */
export function checkFile(file: { name: string; size: number }): BlockingError | undefined {
  if (file.size > MAX_FILE_BYTES) return { code: 'tooLarge', limit: MAX_FILE_BYTES };
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) return { code: 'legacyXls' };
  if (/\.(xlsm|xlsb|xltm|xlam)$/u.test(name)) return { code: 'macroEnabled' };
  if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) return { code: 'unsupportedType' };
  return undefined;
}

const cellText = (cell: Cell): string => {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell;
  if (cell instanceof Date) {
    const day = fromDate(cell);
    return day ? formatIsoDate(day) : '';
  }
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
  return '';
};

const isBlank = (cell: Cell): boolean => cellText(cell).trim() === '';

/** One past the last non-blank cell of the row. */
const usedWidth = (row: readonly Cell[]): number => {
  let width = row.length;
  while (width > 0 && isBlank(row[width - 1])) width--;
  return width;
};

function toErrors(field: ColumnId, error: { issues: readonly { message: string }[] }): RowError[] {
  const seen = new Set<RowErrorCode>();
  const errors: RowError[] = [];
  for (const { message } of error.issues) {
    const code: RowErrorCode =
      message === 'required' || message === 'tooLong' || message === 'tooMany'
        ? message
        : 'invalid';
    if (seen.has(code)) continue;
    seen.add(code);
    const err: RowError = { field, code };
    if (code === 'tooLong' || code === 'tooMany')
      err.max = FIELD_LIMITS[field as keyof typeof FIELD_LIMITS];
    errors.push(err);
  }
  return errors;
}

function validateText(
  field: ColumnId,
  schema: ZodType<string>,
  raw: string,
  errors: RowError[],
): string {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  errors.push(...toErrors(field, parsed.error));
  return normalizeText(raw);
}

function validateRow(
  columns: ReadonlyMap<ColumnId, number>,
  row: readonly Cell[],
  rowNumber: number,
  today: ReturnType<typeof localToday>,
): ParsedRow {
  const errors: RowError[] = [];
  const raw = (id: ColumnId): Cell => {
    const index = columns.get(id);
    return index === undefined ? null : row[index];
  };
  const values: RowValues = { ownerName: '', email: '', subject: '', skills: [], issuedAt: '' };

  values.ownerName = validateText('ownerName', ownerNameSchema, cellText(raw('ownerName')), errors);

  if (columns.has('subject')) {
    values.subject = validateText('subject', subjectSchema, cellText(raw('subject')), errors);
  }

  if (columns.has('email')) {
    const text = cellText(raw('email')).trim();
    const parsed = optionalEmailSchema.safeParse(text);
    if (parsed.success) values.email = parsed.data ?? '';
    else {
      values.email = text;
      errors.push(...toErrors('email', parsed.error));
    }
  }

  if (columns.has('skills')) {
    const items = cellText(raw('skills')).split(/[;,]/u);
    const parsed = skillsSchema.safeParse(items.filter((s) => s.trim() !== ''));
    if (parsed.success) values.skills = parsed.data;
    else {
      values.skills = items.map(normalizeText).filter((s) => s !== '');
      errors.push(...toErrors('skills', parsed.error));
    }
  }

  if (columns.has('issuedAt')) {
    const cell = raw('issuedAt');
    const text = cellText(cell).trim();
    if (text === '') {
      errors.push({ field: 'issuedAt', code: 'required' });
    } else {
      const day =
        cell instanceof Date
          ? fromDate(cell)
          : typeof cell === 'number'
            ? fromSerial(cell)
            : parseDateText(text);
      if (!day) {
        values.issuedAt = text;
        errors.push({ field: 'issuedAt', code: 'invalid' });
      } else {
        values.issuedAt = formatIsoDate(day);
        if (compareDays(day, today) > 0) errors.push({ field: 'issuedAt', code: 'future' });
      }
    }
  }

  return { rowNumber, values, errors };
}

/**
 * Turns a grid of cells (header first) into validated rows. Exported for the format readers.
 *
 * Absent optional columns (`email`, `subject`, `skills`, `issuedAt`) are not validated: they only
 * produce a `missingColumn` notice and an empty value. The consuming UI must treat columns the
 * API requires (`subject`, `issuedAt`) as missing data and not submit such rows as valid.
 *
 * A digits-only date text such as "2024" is read as an Excel serial (day 2024 since 1899-12-30),
 * not as a year, as specified in issue BEU-ICT/certificate-manager#343.
 */
export function processGrid(
  grid: readonly (readonly Cell[])[],
  format: 'xlsx' | 'csv',
  options: ParseOptions = {},
): ParseOutcome {
  const headerIndex = grid.findIndex((row) => row.some((cell) => !isBlank(cell)));
  if (headerIndex < 0) return blocked('empty');
  const header = grid[headerIndex] as readonly Cell[];

  const dataRows: { row: readonly Cell[]; rowNumber: number }[] = [];
  let width = usedWidth(header);
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i] as readonly Cell[];
    const used = usedWidth(row);
    if (used === 0) continue;
    if (used > width) width = used;
    dataRows.push({ row, rowNumber: i + 1 });
  }
  if (width > MAX_COLUMNS) return blocked('tooManyColumns', MAX_COLUMNS);
  if (dataRows.length > MAX_DATA_ROWS) return blocked('tooManyRows', MAX_DATA_ROWS);

  const columns = new Map<ColumnId, number>();
  const notices: Notice[] = [];
  header.forEach((cell, index) => {
    const title = cellText(cell).trim();
    if (title === '') return;
    const id = matchHeader(title);
    if (!id) notices.push({ code: 'unknownColumn', column: title });
    else if (columns.has(id)) notices.push({ code: 'duplicateColumn', column: title });
    else columns.set(id, index);
  });
  if (!columns.has('ownerName')) return blocked('missingOwnerName');
  for (const id of COLUMN_IDS) {
    if (!columns.has(id)) notices.push({ code: 'missingColumn', column: id });
  }

  const today = localToday(options.now ?? new Date());
  const rows = dataRows.map(({ row, rowNumber }) => validateRow(columns, row, rowNumber, today));
  return {
    ok: true,
    format,
    columns: COLUMN_IDS.filter((id) => columns.has(id)),
    rows,
    notices,
  };
}

export function parseCsvText(text: string, options?: ParseOptions): ParseOutcome {
  return processGrid(parseCsv(text, detectDelimiter(text)), 'csv', options);
}

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((b, i) => bytes[i] === b);

/**
 * Zip-bomb guard: walks the central directory without inflating anything (the filter rejects
 * every entry) and sums the declared uncompressed sizes. Returns an error when the archive is
 * too big or is not a readable zip.
 */
function inspectArchive(bytes: Uint8Array): BlockingError | undefined {
  let total = 0;
  class TooLarge extends Error {}
  try {
    unzipSync(bytes, {
      filter: (entry) => {
        total += entry.originalSize;
        if (entry.originalSize > MAX_UNCOMPRESSED_BYTES || total > MAX_UNCOMPRESSED_BYTES)
          throw new TooLarge();
        return false;
      },
    });
  } catch (error) {
    return error instanceof TooLarge
      ? { code: 'tooLarge', limit: MAX_UNCOMPRESSED_BYTES }
      : { code: 'invalidFile' };
  }
  return undefined;
}

async function parseXlsxBuffer(buffer: ArrayBuffer, options?: ParseOptions): Promise<ParseOutcome> {
  const bytes = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return blocked('legacyXls');
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return blocked('invalidFile');
  const archiveProblem = inspectArchive(new Uint8Array(buffer));
  if (archiveProblem) return { ok: false, error: archiveProblem };
  let grid: Cell[][];
  try {
    // Separate chunk, loaded only when an .xlsx file is imported. The "universal" build takes an
    // ArrayBuffer and does not spawn its own worker (this module may already run in one).
    const { readSheet } = await import('read-excel-file/universal');
    grid = await readSheet(buffer, 1);
  } catch {
    return blocked('invalidFile');
  }
  return processGrid(grid, 'xlsx', options);
}

/** Parses an already-loaded file. Limits on name and size are enforced first. */
export async function parseFileContent(
  file: { name: string; size: number },
  buffer: ArrayBuffer,
  options?: ParseOptions,
): Promise<ParseOutcome> {
  const problem = checkFile(file);
  if (problem) return { ok: false, error: problem };
  if (buffer.byteLength > MAX_FILE_BYTES) return blocked('tooLarge', MAX_FILE_BYTES);
  if (file.name.toLowerCase().endsWith('.csv')) {
    let text: string;
    try {
      // Strict UTF-8; a leading BOM is dropped by the decoder.
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return blocked('invalidEncoding');
    }
    return parseCsvText(text, options);
  }
  return parseXlsxBuffer(buffer, options);
}
