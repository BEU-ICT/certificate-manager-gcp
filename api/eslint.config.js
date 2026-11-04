import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { boundaryConfig } from './eslint.boundaries.js';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'node_modules/',
      '.dependency-cruiser.cjs',
      'scripts/',
      // Deliberately rule-breaking inputs for the negative tests, see test/architecture.
      'test/architecture/fixtures/',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js', 'eslint.boundaries.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...boundaryConfig,
);
