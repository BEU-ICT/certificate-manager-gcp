export type Delimiter = ',' | ';' | '\t';

/**
 * Picks the delimiter that occurs most often (outside quotes) in the first record. Ties and
 * single-column files fall back to the comma.
 */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  let seenContent = false;
  for (const ch of text) {
    if (ch === '"') {
      quoted = !quoted;
      seenContent = true;
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (seenContent) break;
    } else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) {
      counts[ch]++;
      seenContent = true;
    } else if (ch.trim() !== '') seenContent = true;
  }
  let best: Delimiter = ',';
  for (const d of [';', '\t'] as const) if (counts[d] > counts[best]) best = d;
  return best;
}

/**
 * RFC 4180 style parser: quoted fields with `""` escapes and embedded delimiters or line breaks,
 * CRLF, LF or CR record separators. One array per record (blank lines included, so callers keep
 * the sheet row numbering).
 */
export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
