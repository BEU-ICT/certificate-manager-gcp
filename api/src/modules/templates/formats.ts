/**
 * Names of the field formatters a template may reference (`fields.<name>.format`).
 *
 * This constant is the contract between the template config schema (BEU-ICT/certificate-manager#304) and the formatter
 * registry (BEU-ICT/certificate-manager#321): the registry must register exactly these names, and each name's `kind` is the
 * `appliesTo` value of its registration. Adding a formatter means adding one entry here.
 */
export const FORMAT_KINDS = ['text', 'date', 'list'] as const;
export type FormatKind = (typeof FORMAT_KINDS)[number];

export const KNOWN_FORMATS = {
  text: 'text',
  uppercase: 'text',
  lowercase: 'text',
  titlecase: 'text',
  'date-dmy': 'date',
  'date-iso': 'date',
  'date-long': 'date',
  'list-comma': 'list',
} as const satisfies Record<string, FormatKind>;

export type FormatName = keyof typeof KNOWN_FORMATS;

export const FORMAT_NAMES = Object.keys(KNOWN_FORMATS) as [FormatName, ...FormatName[]];

export function isKnownFormat(name: string): name is FormatName {
  return Object.hasOwn(KNOWN_FORMATS, name);
}
