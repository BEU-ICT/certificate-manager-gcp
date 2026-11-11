import type { FormatKind } from '../templates/index.js';

/**
 * Field formatter registry (spec §5.2 rule 2, issue BEU-ICT/certificate-manager#321).
 *
 * A formatter turns the raw value of a certificate field into the string that is drawn on the PDF.
 * Names and kinds are the contract with the template config schema (`KNOWN_FORMATS` in the
 * templates module): the built-in set (see `formatters-builtin.ts`) registers exactly those.
 * Adding a formatter needs no change to existing files: call `registry.register(...)`.
 */

/**
 * Timezone in which dates are rendered. `issuedAt` is stored in UTC; the product is used in
 * Azerbaijan, so a certificate issued at 23:30 UTC on 3 November (03:30 on 4 November in Baku)
 * shows 4 November. Baku has no DST (UTC+4 since 2016), so the choice is stable.
 */
export const TEMPLATE_TIMEZONE = 'Asia/Baku';

/** Value type each formatter kind (`appliesTo`) accepts. */
export interface FormatInputByKind {
  text: string;
  /** A `Date` or an ISO-8601 string with an explicit offset (e.g. `2026-11-03T23:30:00.000Z`). */
  date: Date | string;
  list: readonly string[];
}

export interface FormatContext {
  /** Template locale. `az` selects Azerbaijani casing/month names; anything else behaves as `en`. */
  locale: string;
}

export type FormatFn<K extends FormatKind> = (
  value: FormatInputByKind[K],
  ctx: FormatContext,
) => string;

export interface RegisterOptions<K extends FormatKind> {
  appliesTo: K;
}

export class FormatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatterError';
  }
}

interface Entry {
  kind: FormatKind;
  fn: (value: never, ctx: FormatContext) => string;
}

export class FormatterRegistry {
  private readonly entries = new Map<string, Entry>();

  register<K extends FormatKind>(name: string, fn: FormatFn<K>, options: RegisterOptions<K>): this {
    if (name.length === 0) throw new FormatterError('Formatter name must not be empty');
    if (this.entries.has(name))
      throw new FormatterError(`Formatter "${name}" is already registered`);
    this.entries.set(name, { kind: options.appliesTo, fn });
    return this;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** The `appliesTo` kind of a registered formatter, or `undefined` when unknown. */
  kindOf(name: string): FormatKind | undefined {
    return this.entries.get(name)?.kind;
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Applies a formatter; throws `FormatterError` for unknown names or values of the wrong kind. */
  format(name: string, value: unknown, ctx: FormatContext): string {
    const entry = this.entries.get(name);
    if (!entry) throw new FormatterError(`Unknown formatter "${name}"`);
    if (!matchesKind(entry.kind, value)) {
      throw new FormatterError(`Formatter "${name}" expects a ${entry.kind} value`);
    }
    return (entry.fn as (value: unknown, ctx: FormatContext) => string)(value, ctx);
  }
}

function matchesKind(kind: FormatKind, value: unknown): boolean {
  switch (kind) {
    case 'text':
      return typeof value === 'string';
    case 'date':
      return value instanceof Date || typeof value === 'string';
    case 'list':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
}
