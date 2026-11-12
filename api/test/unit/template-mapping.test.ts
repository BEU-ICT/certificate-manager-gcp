import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  inventoryTemplates,
  parseProductionTemplates,
  validateTemplateMapping,
  type TemplateMapping,
} from '../../scripts/lib/template-mapping.js';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const inventory = read('../../../docs/migration/template-inventory.md');
const mapping = JSON.parse(
  read('../../../scripts/migration/template-mapping.json'),
) as TemplateMapping;

const clone = (): TemplateMapping => JSON.parse(JSON.stringify(mapping)) as TemplateMapping;

describe('legacy template mapping', () => {
  it('lists the twelve legacy templates in the inventory', () => {
    expect([...inventoryTemplates(inventory).keys()].sort()).toEqual(
      Object.keys(mapping.templates).sort(),
    );
    expect(inventoryTemplates(inventory).size).toBe(12);
  });

  it('is valid against the inventory; only conf-thanks is pending', () => {
    const report = validateTemplateMapping(mapping, inventory);
    expect(report.errors).toEqual([]);
    expect(report.pending).toEqual(['conf-thanks']);
  });

  it('rejects a production template without mapping or exclusion', () => {
    const report = validateTemplateMapping(mapping, inventory, ['certificate-team', 'old-one']);
    expect(report.errors).toEqual([
      'old-one: found in production data but has no mapping or documented exclusion',
    ]);
  });

  it('rejects a mapping that drifts from the inventory', () => {
    const changed = clone();
    delete changed.templates['certificate-team'];
    changed.templates['extra'] = { status: 'not-migrated', reason: 'x' };
    const errors = validateTemplateMapping(changed, inventory).errors;
    expect(errors).toContain('certificate-team: in the inventory but not in the mapping');
    expect(errors).toContain('extra: in the mapping but not in the inventory');
  });

  it('rejects a wrong reference, an unknown type and an exclusion without a reason', () => {
    const changed = clone();
    changed.templates['certificate-team'] = {
      status: 'migrate',
      organizationSlug: 'beu-ict-lab',
      eventSlug: 'boostcamp-7',
      type: 'team',
      reference: 'beu-ict-lab-boostcamp-7-team-v1',
    };
    changed.templates['certificate-student'] = {
      status: 'migrate',
      organizationSlug: 'beu-ict-lab',
      eventSlug: 'boostcamp-7',
      type: 'pupil',
      reference: 'beu-ict-lab-boostcamp-7-pupil-v0',
    };
    changed.templates['conf-thanks'] = { status: 'not-migrated', reason: ' ' };
    const errors = validateTemplateMapping(changed, inventory).errors.join('\n');
    expect(errors).toContain('certificate-team: reference should be');
    expect(errors).toContain('certificate-student: unknown type "pupil"');
    expect(errors).toContain('conf-thanks: "not-migrated" needs a reason');
  });

  it('parses the output of the production query', () => {
    expect(
      parseProductionTemplates('template\tCOUNT(*)\ncertificate-team\t12\n\nconf-thanks 3\n'),
    ).toEqual(['certificate-team', 'conf-thanks']);
  });
});
