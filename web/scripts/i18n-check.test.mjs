// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkI18n } from './i18n-check.mjs';

const fixture = (name) => ({
  localesDir: fileURLToPath(new URL(`./__fixtures__/${name}/locales`, import.meta.url)),
  srcDir: fileURLToPath(new URL(`./__fixtures__/${name}/src`, import.meta.url)),
});

describe('i18n:check', () => {
  it('passes for consistent locales with plurals and an allow-listed dynamic key', () => {
    expect(checkI18n({ ...fixture('clean'), allow: ['common:dyn.*'] })).toEqual([]);
  });

  it('fails on a dynamic key without allow-list entry', () => {
    expect(checkI18n({ ...fixture('clean'), allow: [] })).toEqual(['unused key: common:dyn.a']);
  });

  it('fails on a seeded missing key and other inconsistencies', () => {
    const problems = checkI18n({ ...fixture('broken'), allow: [] });
    expect(problems).toContain('used in code but missing: common:seededMissingKey');
    expect(problems).toContain('used in code but missing: errors:NOPE');
    expect(problems).toContain('missing in en: common:onlyAz (present in az)');
    expect(problems).toContain('unused key: common:onlyAz');
    expect(problems).toContain('unused key: common:unused');
  });

  it('passes for the real locale files', () => {
    expect(
      checkI18n({
        localesDir: fileURLToPath(new URL('../src/locales', import.meta.url)),
        srcDir: fileURLToPath(new URL('../src', import.meta.url)),
      }),
    ).toEqual([]);
  });
});
