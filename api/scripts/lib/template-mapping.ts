// Validation of scripts/migration/template-mapping.json against docs/migration/template-inventory.md
// (BEU-ICT/certificate-manager#404). Pure functions; the CLI is scripts/migration/validate-template-mapping.ts.
import { isCertificateType } from '../../src/shared/certificate-types.js';
import { TEMPLATE_REF_PATTERN } from '../../src/shared/ids.js';
import { buildTemplateReference } from '../../src/modules/templates/index.js';

export type MappingEntry =
  | {
      status: 'migrate';
      organizationSlug: string;
      eventSlug: string;
      type: string;
      reference: string;
    }
  | { status: 'not-migrated'; reason: string }
  | { status: 'pending'; reason: string };

export interface TemplateMapping {
  organization?: { name?: string; slug?: string };
  templates: Record<string, MappingEntry>;
}

export interface MappingReport {
  errors: string[];
  /** Entries that still wait for a stakeholder decision. */
  pending: string[];
}

/** Legacy template names (first cell of each row of the inventory table, written as `name`). */
export function inventoryTemplates(markdown: string): Map<string, string> {
  const rows = new Map<string, string>();
  const start = markdown.indexOf('<!-- BEGIN INVENTORY -->');
  const end = markdown.indexOf('<!-- END INVENTORY -->');
  if (start < 0 || end < start) throw new Error('Inventory markers are missing');
  for (const line of markdown.slice(start, end).split('\n')) {
    const match = /^\|\s*`([a-z0-9-]+)`\s*\|/.exec(line);
    if (match) rows.set(match[1] as string, line);
  }
  return rows;
}

/** Template values from the production query: one per line, optionally followed by a count. */
export function parseProductionTemplates(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().split(/[\s,\t|]+/)[0] ?? '')
    .filter((value) => value !== '' && value.toLowerCase() !== 'template');
}

export function validateTemplateMapping(
  mapping: TemplateMapping,
  inventoryMarkdown: string,
  productionTemplates?: readonly string[],
): MappingReport {
  const errors: string[] = [];
  const pending: string[] = [];
  const inventory = inventoryTemplates(inventoryMarkdown);
  const orgSlug = mapping.organization?.slug;

  for (const name of inventory.keys()) {
    if (!(name in mapping.templates))
      errors.push(`${name}: in the inventory but not in the mapping`);
  }
  for (const [name, entry] of Object.entries(mapping.templates)) {
    const row = inventory.get(name);
    if (row === undefined) {
      errors.push(`${name}: in the mapping but not in the inventory`);
      continue;
    }
    if (entry.status === 'migrate') {
      if (entry.organizationSlug !== orgSlug) {
        errors.push(
          `${name}: organizationSlug "${entry.organizationSlug}" is not the mapped organization`,
        );
      }
      if (!isCertificateType(entry.type)) errors.push(`${name}: unknown type "${entry.type}"`);
      try {
        const expected = buildTemplateReference(
          entry.organizationSlug,
          entry.eventSlug,
          entry.type,
          0,
        );
        if (entry.reference !== expected) {
          errors.push(`${name}: reference should be "${expected}", found "${entry.reference}"`);
        }
      } catch {
        errors.push(`${name}: organization, event or type do not form a valid reference`);
      }
      if (!TEMPLATE_REF_PATTERN.test(entry.reference)) {
        errors.push(`${name}: "${entry.reference}" is not a valid template reference`);
      }
      if (!row.includes(`\`${entry.reference}\``)) {
        errors.push(
          `${name}: the inventory row does not show the reference \`${entry.reference}\``,
        );
      }
    } else if (entry.status === 'not-migrated' || entry.status === 'pending') {
      if (entry.reason.trim() === '') errors.push(`${name}: "${entry.status}" needs a reason`);
      if (entry.status === 'pending') pending.push(name);
    } else {
      errors.push(`${name}: unknown status`);
    }
  }
  const references = new Map<string, string>();
  for (const [name, entry] of Object.entries(mapping.templates)) {
    if (entry.status !== 'migrate') continue;
    const other = references.get(entry.reference);
    if (other !== undefined) errors.push(`${name}: reference also used by ${other}`);
    references.set(entry.reference, name);
  }
  if (productionTemplates) {
    for (const value of new Set(productionTemplates)) {
      if (!(value in mapping.templates)) {
        errors.push(
          `${value}: found in production data but has no mapping or documented exclusion`,
        );
      }
    }
  }
  return { errors, pending };
}
