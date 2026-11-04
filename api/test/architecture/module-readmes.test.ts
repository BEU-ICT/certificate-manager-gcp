// Negative test for the module README guard (scripts/check-module-readmes.mjs): a modules
// directory with a module lacking README.md must fail and name the module; a complete one and
// the real src/modules tree must pass.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(apiRoot, 'scripts/check-module-readmes.mjs');
const fixtures = path.join(apiRoot, 'test/architecture/fixtures/module-readmes');

async function run(modulesDir?: string): Promise<{ code: number; stderr: string }> {
  try {
    await execFileAsync('node', modulesDir === undefined ? [script] : [script, modulesDir]);
    return { code: 0, stderr: '' };
  } catch (error) {
    const e = error as { code: number; stderr: string };
    return { code: e.code, stderr: e.stderr };
  }
}

describe('module README check', () => {
  it('passes when every module directory has a README.md', async () => {
    expect((await run(path.join(fixtures, 'ok'))).code).toBe(0);
  });

  it('fails and names the module whose README.md is missing', async () => {
    const result = await run(path.join(fixtures, 'missing'));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(path.join('b', 'README.md'));
    expect(result.stderr).not.toContain(path.join('a', 'README.md'));
  });

  it('passes for the real src/modules tree', async () => {
    expect((await run()).code).toBe(0);
  });
});
