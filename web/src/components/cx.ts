/** Joins class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Shared look of text-like controls (input, textarea, select, combobox). */
export const controlClass =
  'block w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink ' +
  'placeholder:text-ink-muted disabled:cursor-not-allowed disabled:bg-surface-muted ' +
  'disabled:text-ink-muted aria-[invalid=true]:border-danger';
