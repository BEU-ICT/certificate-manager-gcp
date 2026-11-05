/**
 * Mirrors `api/src/shared/slug.ts` (issue #16 section 5): the same rules decide the slug that the
 * form suggests while typing and the one the API accepts. A shared package is out of scope, so
 * keep both files in sync (like `certificateTypes.ts`).
 */
export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 40;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Letters that Unicode normalisation does not reduce to a base letter. */
const TRANSLITERATION: Readonly<Record<string, string>> = {
  // Azerbaijani (Latin)
  ə: 'e',
  ı: 'i',
  // Other Latin letters without a decomposition
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ł: 'l',
  þ: 'th',
  // Cyrillic (Russian) and the extra Azerbaijani Cyrillic letters
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ә: 'e',
  ғ: 'g',
  ҝ: 'g',
  ҹ: 'c',
  ң: 'n',
  ө: 'o',
  ү: 'u',
  һ: 'h',
  ј: 'j',
};

export function isValidSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= SLUG_MIN_LENGTH &&
    value.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(value)
  );
}

/**
 * Derives a slug from free text: lower-case first (so `İ` becomes `i̇` and `I` becomes `i`),
 * transliterate, NFKD-normalise and drop combining marks, replace every other run of non
 * `[a-z0-9]` characters by one hyphen, trim hyphens and cut to 40 characters on a hyphen boundary.
 * Returns an empty string when nothing usable is left; callers must reject that and any result
 * shorter than the minimum (use {@link isValidSlug}).
 */
export function slugify(input: string): string {
  const lowered = input.normalize('NFKD').toLowerCase();
  let out = '';
  for (const ch of lowered) out += TRANSLITERATION[ch] ?? ch;
  // NFKD split accented letters into base + combining mark; the table above ran on the
  // composed leftovers, so run it once more after removing the marks.
  const ascii = out.normalize('NFKD').replace(/\p{M}+/gu, '');
  let slug = '';
  for (const ch of ascii) slug += TRANSLITERATION[ch] ?? ch;
  slug = slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_MAX_LENGTH) {
    const cut = slug.slice(0, SLUG_MAX_LENGTH + 1);
    const boundary = cut.lastIndexOf('-');
    slug = (
      boundary >= SLUG_MIN_LENGTH ? cut.slice(0, boundary) : slug.slice(0, SLUG_MAX_LENGTH)
    ).replace(/-+$/g, '');
  }
  return slug;
}

/** `base-2`, `base-3`, ...; keeps the result within the length limit by shortening `base`. */
export function withSuffix(base: string, n: number): string {
  const suffix = `-${String(n)}`;
  const head = base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, '');
  return `${head}${suffix}`;
}
