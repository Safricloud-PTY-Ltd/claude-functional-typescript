import { defineConfig } from 'vitest/config';

// Type tests run tsc over the sources. Under Stryker the sources are instrumented copies whose
// injected helpers have no type annotations, so `isolatedDeclarations` fails on every file and
// ends Stryker's dry run (measured in genesys-auth-provider, 2026-10-21). A mutant can't change
// what a type test checks, so they're off there.
const UNDER_STRYKER = process.env['STRYKER_MUTATOR_WORKER'] !== undefined;

export default defineConfig({
  test: {
    name: 'shared',
    // {ts,tsx}: .tsx tests are accepted; rendering JSX needs a jsx setting in tsconfig.
    include: ['src/**/*.test.{ts,tsx}'],
    typecheck: { enabled: !UNDER_STRYKER, include: ['src/**/*.test-d.{ts,tsx}'] },
  },
});
