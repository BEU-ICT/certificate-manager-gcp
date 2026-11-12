import type { ColumnId, ParsedRow, RowErrorCode } from '@/lib/bulk';
import type { BulkItem } from './bulk-api';

/** The API accepts at most this many items per bulk request. */
export const CHUNK_SIZE = 500;

export type IssueCode = RowErrorCode | 'subjectRequired';

/** A problem with one cell: found by the parser, by the wizard, or reported by the server. */
export interface RowIssue {
  field: ColumnId;
  code: IssueCode;
  max?: number | undefined;
  /** Set for problems reported by the server; shown as written. */
  serverMessage?: string | undefined;
}

/**
 * The problems of a row as the preview shows them. A common subject makes an empty subject cell
 * acceptable; without one, every row needs its own subject (the API requires one of the two).
 */
export function rowIssues(row: ParsedRow, hasCommonSubject: boolean): RowIssue[] {
  const issues: RowIssue[] = row.errors
    .filter((e) => !(hasCommonSubject && e.field === 'subject' && e.code === 'required'))
    .map((e) => ({ field: e.field, code: e.code, max: e.max }));
  if (
    !hasCommonSubject &&
    row.values.subject === '' &&
    !issues.some((i) => i.field === 'subject')
  ) {
    issues.push({ field: 'subject', code: 'subjectRequired' });
  }
  return issues;
}

/** Request item of a row; the e-mail address and the other optional fields are sent only when set. */
export function toBulkItem(row: ParsedRow, issuedAtToday: string, today: string): BulkItem {
  const { values } = row;
  const date = values.issuedAt;
  const hasDate = /^\d{4}-\d{2}-\d{2}$/u.test(date);
  return {
    ownerName: values.ownerName,
    ...(values.email !== '' ? { email: values.email } : {}),
    ...(values.subject !== '' ? { subject: values.subject } : {}),
    ...(values.skills.length > 0 ? { skills: values.skills } : {}),
    // Today is sent as the import's start instant (noon UTC may lie in the future); other days as noon UTC.
    ...(hasDate ? { issuedAt: date === today ? issuedAtToday : `${date}T12:00:00.000Z` } : {}),
  };
}

export function splitChunks<T>(rows: readonly T[], size: number = CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface FileFingerprint {
  name: string;
  size: number;
  lastModified: number;
}

/**
 * `sha256(fileName + size + lastModified + chunkIndex + rowsHash)`. `rowsHash` covers the whole
 * request body, so a chunk whose content changed (rows excluded) never reuses a key of another body.
 */
export async function chunkIdempotencyKey(
  file: FileFingerprint,
  chunkIndex: number,
  rowsHash: string,
): Promise<string> {
  return sha256Hex(
    [file.name, String(file.size), String(file.lastModified), String(chunkIndex), rowsHash].join(
      '\n',
    ),
  );
}

/** `items[17].ownerName` becomes `{ index: 17, field: 'ownerName' }`; other paths give `null`. */
export function parseItemPath(path: string): { index: number; field: string } | null {
  const match = /^items\[(\d+)\](?:\.([A-Za-z]+))?/u.exec(path);
  if (!match?.[1]) return null;
  return { index: Number(match[1]), field: match[2] ?? '' };
}

/**
 * Starts with `=`, `+`, `-`, `@`, tab or CR: a spreadsheet would run it as a formula (CSV injection).
 * The cell is prefixed with an apostrophe, which spreadsheets read as "text".
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

export function buildCsv(rows: readonly (readonly string[])[]): Blob {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return new Blob(['﻿', text, '\r\n'], { type: 'text/csv;charset=utf-8' });
}

export interface WindowRange {
  start: number;
  end: number;
  /** Pixels above the first and below the last rendered row. */
  before: number;
  after: number;
}

/**
 * Which rows of a fixed-height list to render for a scroll position: the visible ones plus
 * `overscan` on each side. Everything is rendered when `count` is at most `threshold`.
 */
export function windowRange(options: {
  count: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan?: number;
  threshold?: number;
}): WindowRange {
  const { count, rowHeight, viewportHeight, scrollTop, overscan = 8, threshold = 500 } = options;
  if (count <= threshold) return { start: 0, end: count, before: 0, after: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, Math.min(count - 1, first - overscan));
  const end = Math.min(count, first + visible + overscan);
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}
