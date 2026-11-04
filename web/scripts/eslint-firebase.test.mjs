// @vitest-environment node
// Negative fixtures for the rule that keeps the Firebase SDK inside src/auth (#71): the real
// project config is resolved per file path, then only its `no-restricted-imports` setting is run
// against inline fixtures (no type information needed).
import { fileURLToPath } from 'node:url';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd });

async function lint(filePath, code) {
  const config = await eslint.calculateConfigForFile(filePath);
  const linter = new Linter({ cwd });
  const messages = linter.verify(
    code,
    [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: { parser: tseslint.parser },
        rules: {
          'no-restricted-imports': config.rules['no-restricted-imports'],
          'no-restricted-syntax': config.rules['no-restricted-syntax'],
        },
      },
    ],
    { filename: filePath },
  );
  return messages.map((m) => m.message);
}

describe('no-restricted-imports for the Firebase SDK', () => {
  for (const specifier of ['firebase/auth', 'firebase/app', 'firebase', '@firebase/auth']) {
    it(`rejects "${specifier}" outside src/auth`, async () => {
      for (const file of ['src/pages/Bad.ts', 'src/admin/Bad.tsx', 'src/api/bad.ts']) {
        const messages = await lint(file, `import * as sdk from '${specifier}';\nvoid sdk;\n`);
        expect(messages, file).toEqual([expect.stringContaining('Import the Firebase SDK only')]);
      }
    });
  }

  it('rejects a dynamic import() outside src/auth', async () => {
    const messages = await lint(
      'src/pages/bad.ts',
      `export const sdk = import('firebase/auth');\n`,
    );
    expect(messages).toEqual([expect.stringContaining('Import the Firebase SDK only')]);
  });

  it('rejects a re-export outside src/auth', async () => {
    const messages = await lint('src/lib/bad.ts', `export { getAuth } from 'firebase/auth';\n`);
    expect(messages).toHaveLength(1);
  });

  it('allows the SDK inside src/auth', async () => {
    const messages = await lint(
      'src/auth/ok.ts',
      `import { getAuth } from 'firebase/auth';\nvoid getAuth;\n`,
    );
    expect(messages).toEqual([]);
  });

  it('allows unrelated imports elsewhere', async () => {
    const messages = await lint(
      'src/pages/Ok.ts',
      `import { useAuth } from '@/auth';\nvoid useAuth;\n`,
    );
    expect(messages).toEqual([]);
  });
});
