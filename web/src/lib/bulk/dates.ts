/** Excel serial 1 = 1900-01-01 with the 1900 leap-year bug, so day 0 is 1899-12-30. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/** 9999-12-31 */
const MAX_SERIAL = 2_958_465;

export interface YearMonthDay {
  year: number;
  month: number;
  day: number;
}

function valid(year: number, month: number, day: number): YearMonthDay | undefined {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return undefined;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1) return undefined;
  if (check.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

export function formatIsoDate({ year, month, day }: YearMonthDay): string {
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)}`;
}

export function fromSerial(serial: number): YearMonthDay | undefined {
  if (!Number.isFinite(serial) || serial < 1 || serial >= MAX_SERIAL + 1) return undefined;
  const d = new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * DAY_MS);
  return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Date cells from the xlsx reader are UTC midnight of the calendar day. */
export function fromDate(date: Date): YearMonthDay | undefined {
  if (Number.isNaN(date.getTime())) return undefined;
  return valid(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** `YYYY-MM-DD`, `DD.MM.YYYY` or an Excel date serial (digits only). */
export function parseDateText(raw: string): YearMonthDay | undefined {
  const value = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u.exec(value);
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  if (/^\d{1,7}(\.\d+)?$/u.test(value)) return fromSerial(Number(value));
  return undefined;
}

/** Calendar day of `now` on the user's clock, so "today" is never rejected as future. */
export function localToday(now: Date): YearMonthDay {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export function compareDays(a: YearMonthDay, b: YearMonthDay): number {
  return formatIsoDate(a).localeCompare(formatIsoDate(b));
}
