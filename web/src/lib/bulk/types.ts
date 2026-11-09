import type { ColumnId } from './headers';
import type { RowErrorCode } from './schemas';

export type BlockingErrorCode =
  | 'tooLarge'
  | 'legacyXls'
  | 'macroEnabled'
  | 'unsupportedType'
  | 'invalidFile'
  | 'invalidEncoding'
  | 'empty'
  | 'tooManyRows'
  | 'tooManyColumns'
  | 'missingOwnerName';

/** The file cannot be imported at all; `limit` carries the limit that was exceeded. */
export interface BlockingError {
  code: BlockingErrorCode;
  limit?: number;
}

/** Non-blocking remark about the file's columns; `column` is the header as written. */
export type Notice =
  | { code: 'unknownColumn'; column: string }
  | { code: 'duplicateColumn'; column: string }
  | { code: 'missingColumn'; column: ColumnId };

/** Normalised cell values when valid, the trimmed raw text otherwise. */
export interface RowValues {
  ownerName: string;
  email: string;
  subject: string;
  skills: string[];
  /** `YYYY-MM-DD`, or the raw text when it could not be read as a date. */
  issuedAt: string;
}

export interface RowError {
  field: ColumnId;
  code: RowErrorCode;
  /** The limit behind `tooLong` / `tooMany`, for messages. */
  max?: number;
}

export interface ParsedRow {
  /** Row number as shown in the spreadsheet (the header is row 1 when it is the first row). */
  rowNumber: number;
  values: RowValues;
  errors: RowError[];
}

export type ParseOutcome =
  | {
      ok: true;
      format: 'xlsx' | 'csv';
      /** Columns recognised in the header. Fields of absent columns are not validated. */
      columns: ColumnId[];
      rows: ParsedRow[];
      notices: Notice[];
    }
  | { ok: false; error: BlockingError };

export interface ParseOptions {
  /** Clock for the "not in the future" rule; defaults to the current time. */
  now?: Date;
}
