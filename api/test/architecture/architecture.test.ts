// Negative tests for the architecture rules: every fixture that violates a rule must make the
// corresponding check fail with the right rule name, and the allowed fixtures must pass, which
// proves that the rules are live and not trivially satisfied. Run with `npm run test:architecture`
// (also part of `npm test`).
//
// Fixtures live in test/architecture/fixtures (excluded from lint, typecheck and depcruise).
// - depcruise/<case>/src/**: a miniature source tree cruised with the real config.
// - eslint/<file>.ts: linted as if it lived at a virtual path inside the real source tree.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = path.join(apiRoot, 'test/architecture/fixtures');

// --- dependency-cruiser ----------------------------------------------------------------------

/** Runs the real CLI (exit code included) on a fixture tree; `violations` are the broken rule names. */
async function cruise(fixture: string): Promise<{ failed: boolean; violations: string[] }> {
  const args = [
    path.join(depcruiseDir(), 'bin/dependency-cruiser.mjs'),
    '--config',
    path.join(apiRoot, '.dependency-cruiser.cjs'),
    '--ts-config',
    path.join(apiRoot, 'tsconfig.json'),
    '--output-type',
    'err',
    'src',
  ];
  const options = { cwd: path.join(fixtures, 'depcruise', fixture) };
  let stdout: string;
  let failed = false;
  try {
    ({ stdout } = await execFileAsync(process.execPath, args, options));
  } catch (error) {
    const result = error as { stdout?: string; code?: number }; // exit code = number of errors
    if (typeof result.code !== 'number' || result.code < 1 || typeof result.stdout !== 'string')
      throw error;
    failed = true;
    stdout = result.stdout;
  }
  const violations = [...stdout.matchAll(/^\s+error ([\w-]+):/gm)].map((m) => m[1] ?? '');
  return { failed, violations };
}

// The package only exposes an ESM entry point, so locate its folder (hoisted or local) by path.
function depcruiseDir(): string {
  for (const base of [apiRoot, path.dirname(apiRoot)]) {
    const dir = path.join(base, 'node_modules/dependency-cruiser');
    if (existsSync(dir)) return dir;
  }
  throw new Error('dependency-cruiser is not installed');
}

const cruiseCases: [fixture: string, rule: string][] = [
  ['circular', 'no-circular'],
  ['deep-import', 'modules-only-via-public-index'],
  ['module-to-adapter', 'modules-and-ports-not-to-adapters-or-http'],
  ['module-to-http', 'modules-and-ports-not-to-adapters-or-http'],
  ['port-to-adapter', 'modules-and-ports-not-to-adapters-or-http'],
  ['port-to-module', 'ports-only-ports-and-shared'],
  ['adapter-to-module', 'adapters-not-to-module-internals'],
  ['testing-from-production', 'testing-not-from-production-code'],
];

describe('dependency-cruiser rules', { timeout: 60_000 }, () => {
  it.each(cruiseCases)('fixture %s fails with rule %s', async (fixture, rule) => {
    const result = await cruise(fixture);
    expect(result.failed).toBe(true);
    expect(result.violations).toContain(rule); // a fixture may break more than one rule
  });

  it('accepts every allowed dependency direction', async () => {
    const result = await cruise('ok');
    expect(result).toEqual({ failed: false, violations: [] });
  });
});

// --- ESLint ----------------------------------------------------------------------------------

const { boundaryConfig } = (await import(
  pathToFileURL(path.join(apiRoot, 'eslint.boundaries.js')).href
)) as {
  boundaryConfig: Linter.Config[];
};

// Same boundary rules as the real config, but without type information so that fixtures can
// pretend to live at any path.
const eslint = new ESLint({
  cwd: apiRoot,
  overrideConfigFile: true,
  baseConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...boundaryConfig,
  ],
});

async function lintAs(
  fixture: string,
  virtualPath: string,
): Promise<ESLint.LintResult['messages']> {
  const source = readFileSync(path.join(fixtures, 'eslint', fixture), 'utf8');
  const [result] = await eslint.lintText(source, { filePath: path.join(apiRoot, virtualPath) });
  return result?.messages ?? [];
}

const vendorSdkPackages = [
  'firebase-admin/app',
  '@google-cloud/storage',
  'googleapis',
  'google-auth-library',
  'nodemailer',
  'pg',
  '@aws-sdk/client-s3',
  'firebase-admin',
];

describe('ESLint vendor import restriction', () => {
  const forbiddenPaths = [
    'src/modules/certificates/repository.ts',
    'src/ports/repositories.ts',
    'src/http/routes/certificates.ts',
    'src/shared/domain.ts',
    'src/app.ts',
    'test/unit/something.test.ts',
  ];

  it.each(forbiddenPaths)('rejects @google-cloud/firestore in %s', async (virtualPath) => {
    const messages = await lintAs('firestore-import.ts', virtualPath);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('no-restricted-imports');
    expect(messages[0]?.message).toContain('src/adapters/**');
  });

  it('rejects every listed vendor SDK in a module', async () => {
    const messages = await lintAs('vendor-imports.ts', 'src/modules/certificates/service.ts');
    expect(messages.map((m) => m.ruleId)).toEqual(
      vendorSdkPackages.map(() => 'no-restricted-imports'),
    );
  });

  it('rejects dynamic import() and require() of vendors', async () => {
    const messages = await lintAs('vendor-dynamic.ts', 'src/modules/events/service.ts');
    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-syntax', 'no-restricted-syntax']);
  });

  it.each([
    'src/adapters/firestore/client.ts',
    'src/testing/emulator.ts',
    'test/integration/db.ts',
  ])('allows vendor imports in %s', async (virtualPath) => {
    expect(await lintAs('allowed-vendor.ts', virtualPath)).toEqual([]);
  });
});

describe('ESLint src/testing restriction', () => {
  it.each([
    'src/modules/certificates/service.ts',
    'src/adapters/memory/clock.ts',
    'src/http/routes/health.ts',
    'src/app.ts',
  ])('rejects importing src/testing from %s', async (virtualPath) => {
    const messages = await lintAs('testing-import.ts', virtualPath);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('no-restricted-imports');
    expect(messages[0]?.message).toContain('src/testing/**');
  });

  it.each(['test/unit/certificates.test.ts', 'test/integration/db.test.ts'])(
    'allows importing src/testing from %s',
    async (virtualPath) => {
      expect(await lintAs('allowed-testing-from-test.ts', virtualPath)).toEqual([]);
    },
  );

  it('allows src/testing to import its own files', async () => {
    expect(await lintAs('testing-import.ts', 'src/testing/fakes.ts')).toEqual([]);
  });
});

describe('ESLint DocumentReference restriction', () => {
  it.each([
    'src/modules/certificates/service.ts',
    'src/ports/repositories.ts',
    'src/testing/fakes.ts',
    'test/unit/something.test.ts',
  ])('rejects DocumentReference in %s', async (virtualPath) => {
    const messages = await lintAs('document-reference.ts', virtualPath);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('no-restricted-syntax');
    expect(messages[0]?.message).toContain('DocumentReference');
  });

  it.each(['src/adapters/firestore/mapper.ts', 'test/integration/db.ts'])(
    'allows DocumentReference in %s',
    async (virtualPath) => {
      expect(await lintAs('document-reference.ts', virtualPath)).toEqual([]);
    },
  );
});

describe('ESLint allows ordinary imports', () => {
  it('does not flag relative, port and zod imports in a module', async () => {
    expect(await lintAs('allowed-plain.ts', 'src/modules/certificates/service.ts')).toEqual([]);
  });
});
