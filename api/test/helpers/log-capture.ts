import { Writable } from 'node:stream';

/** Collects every log line an app writes; pass `stream` as `log.destination`. */
export function captureLogs(): {
  stream: Writable;
  raw: () => string;
  lines: () => Record<string, unknown>[];
} {
  let out = '';
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  return {
    stream,
    raw: () => out,
    lines: () =>
      out
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

const EMAIL_SHAPED = /[^\s"@\\]+@[^\s"@\\]+\.[a-z]{2,}/i;
const JWT_SHAPED = /eyJ[\w-]+\.[\w-]+\.[\w-]*/;

/** Problems found in `raw` log output: email-shaped or JWT-shaped strings and forbidden values. */
export function privacyViolations(raw: string, forbidden: readonly string[]): string[] {
  const problems: string[] = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    if (EMAIL_SHAPED.test(line)) problems.push(`email-shaped string in: ${line}`);
    if (JWT_SHAPED.test(line)) problems.push(`JWT-shaped string in: ${line}`);
    for (const value of forbidden) {
      if (line.includes(value)) problems.push(`"${value}" in: ${line}`);
    }
  }
  return problems;
}
