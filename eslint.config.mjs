import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typeCheckedFiles = ['**/*.{ts,tsx}'];
const implementationFiles = [
  'src/**/*.{ts,tsx}',
  'scripts/**/*.mjs',
  'examples/**/*.{ts,tsx}',
  '*.{ts,mjs}',
];

export default tseslint.config(
  {
    ignores: ['**/.next/**', 'coverage/**', 'dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  {
    rules: {
      complexity: ['error', 10],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'no-else-return': 'error',
      'no-ternary': 'error',
    },
  },
  ...tseslint.configs.strictTypeChecked.map((configuration) => ({
    ...configuration,
    files: typeCheckedFiles,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((configuration) => ({
    ...configuration,
    files: typeCheckedFiles,
  })),
  {
    files: typeCheckedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          fixStyle: 'inline-type-imports',
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        {
          ignoreArrowShorthand: true,
        },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        {
          allowConstantLoopConditions: 'only-allowed-literals',
        },
      ],
    },
  },
  {
    files: implementationFiles,
    rules: {
      'max-lines-per-function': [
        'error',
        {
          IIFEs: true,
          max: 80,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
