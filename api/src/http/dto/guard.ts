/**
 * Fields that must never appear in a public DTO (spec §5.2 rule 3: DTOs are separate from
 * domain entities). Enforced by test/unit/dto-guard.test.ts on every schema under
 * `src/http/dto/public/` and on the generated OpenAPI document.
 */
export const FORBIDDEN_PUBLIC_FIELDS: readonly string[] = [
  'email',
  'pdfPath',
  'createdBy',
  'revokeReason',
];

/**
 * Returns the location of every property named like a forbidden field anywhere inside a
 * JSON Schema / OpenAPI document (case-insensitive).
 */
export function findForbiddenFields(node: unknown, path = '#'): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => findForbiddenFields(item, `${path}/${i}`));
  }
  if (typeof node !== 'object' || node === null) return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_PUBLIC_FIELDS.some((f) => f.toLowerCase() === name.toLowerCase())) {
          found.push(`${path}/properties/${name}`);
        }
        found.push(...findForbiddenFields(sub, `${path}/properties/${name}`));
      }
    } else {
      found.push(...findForbiddenFields(value, `${path}/${key}`));
    }
  }
  return found;
}
