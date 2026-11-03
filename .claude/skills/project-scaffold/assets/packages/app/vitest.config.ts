import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// See packages/shared/vitest.config.ts for why type tests are off under Stryker.
const UNDER_STRYKER = process.env['STRYKER_MUTATOR_WORKER'] !== undefined;

export default defineConfig({
  // Resolve `#shared` from this file rather than through node_modules: under Stryker the
  // sandbox's node_modules is a junction back to the original tree, so the package link would
  // load the unmutated shared source.
  resolve: {
    alias: { '#shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  test: {
    name: 'app',
    include: ['src/**/*.test.{ts,tsx}'],
    typecheck: { enabled: !UNDER_STRYKER, include: ['src/**/*.test-d.{ts,tsx}'] },
  },
});
