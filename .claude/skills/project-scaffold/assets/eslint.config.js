// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import functional from 'eslint-plugin-functional';
import jsdoc from 'eslint-plugin-jsdoc';
import importX from 'eslint-plugin-import-x';
import neverthrow from '@ninoseki/eslint-plugin-neverthrow';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';

export default defineConfig(
  globalIgnores([
    'dist/**',
    'coverage/**',
    'reports/**',
    '.pnpm-store/**', // ESLint doesn't read .gitignore; pnpm makes this store in a sandbox
    '.claude/**',
    'contributions/**',
    '.dependency-cruiser.cjs',
  ]),

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  jsdoc.configs['flat/recommended-typescript-error'],
  functional.configs.recommended,
  functional.configs.stylistic,

  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.config.js', '*.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
      jsdoc: { mode: 'typescript' },
    },
    plugins: { neverthrow },
    rules: {
      // Errors are values.
      'neverthrow/must-use-result': 'error',
      'functional/no-throw-statements': 'error',
      'functional/no-try-statements': 'error',

      // No OOP, no mutation, no rebinding.
      'functional/no-classes': 'error',
      'functional/no-this-expressions': 'error',
      'functional/no-let': 'error',
      'functional/immutable-data': 'error',
      'functional/prefer-immutable-types': [
        'error',
        { enforcement: 'ReadonlyShallow', ignoreInferredTypes: true },
      ],
      'functional/type-declaration-immutability': 'off',
      'functional/readonly-type': ['error', 'keyword'],
      'functional/no-mixed-types': 'off',
      'functional/prefer-tacit': 'off',

      // Statements are fine; this is TypeScript, not Haskell.
      'functional/no-conditional-statements': 'off',
      'functional/no-expression-statements': 'off',
      'functional/no-loop-statements': 'error',
      'functional/no-return-void': 'off',
      'functional/functional-parameters': 'off',

      // Size and shape.
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 3],
      'max-depth': ['error', 3],
      complexity: ['error', 8],
      'no-param-reassign': 'error',
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Use a union of string literals.' },
        { selector: 'TSModuleDeclaration', message: 'No namespaces.' },
        { selector: 'ExportDefaultDeclaration', message: 'Named exports only.' },
        {
          selector: 'Literal[raw="null"]',
          message: 'Absence is `undefined`; convert null at the shell.',
        },
        { selector: 'FunctionDeclaration', message: 'Use `export const name = (...) => ...`.' },
        {
          selector: ':function VariableDeclarator > ArrowFunctionExpression',
          message:
            'A named function inside a function is a contract the architect has not written. Report it under Needs.',
        },
        // ESM only. A require loads a second copy outside the test runner's pipeline, which
        // silently overwrites coverage. Load late with `await import()` at an async boundary.
        {
          selector: 'ImportSpecifier[imported.name="createRequire"]',
          message: 'ESM only: use `await import()` at an async boundary, not createRequire.',
        },
        {
          selector: 'CallExpression[callee.name=/^(require|createRequire)$/]',
          message: 'ESM only: use `import` or `await import()`, not require.',
        },
        {
          selector: 'MemberExpression[object.name="require"]',
          message: 'ESM only: no require.resolve or require.cache; use import.meta.resolve.',
        },
      ],

      // Types.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/array-type': ['error', { default: 'array', readonly: 'generic' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // Imports.
      'import-x/no-default-export': 'error',
      'import-x/no-cycle': 'error',
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
      'import-x/no-relative-packages': 'error',
      'import-x/extensions': ['error', 'ignorePackages', { ts: 'always' }],

      // JSDoc is the contract.
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: { ArrowFunctionExpression: true, FunctionDeclaration: true },
          contexts: [
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
          ],
        },
      ],
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/no-types': 'error',
      'jsdoc/check-tag-names': ['error', { definedTags: ['errors'] }],
      'jsdoc/require-throws-type': 'off',
      'jsdoc/tag-lines': 'off',
    },
  },

  // Shell adapters convert a foreign, throwing API into Results.
  {
    files: ['src/**/shell/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}', 'src/shared/stub.ts'],
    rules: {
      'functional/no-throw-statements': 'off',
      'functional/no-try-statements': 'off',
    },
  },

  // Tests: describe/it blocks are long by nature; fixtures are literal.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.test-d.{ts,tsx}'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'jsdoc/require-jsdoc': 'off',
      'functional/immutable-data': 'off',
      'functional/prefer-immutable-types': 'off',
      'neverthrow/must-use-result': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  // Config files are not domain code. The size rules are off too: this file itself is past
  // max-lines (161 counted lines against 150, issue #14).
  {
    files: ['*.config.js', '*.config.ts'],
    rules: {
      'import-x/no-default-export': 'off',
      'no-restricted-syntax': 'off',
      'jsdoc/require-jsdoc': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },

  prettier,
);
