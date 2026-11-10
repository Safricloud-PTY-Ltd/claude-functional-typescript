import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// See packages/shared/vitest.config.ts for why type tests are off under Stryker.
const UNDER_STRYKER = process.env['STRYKER_MUTATOR_WORKER'] !== undefined;

// The normal, slow and perf suites, chosen with `vitest --mode`; see
// packages/shared/vitest.config.ts for what each holds and where it runs.
const TESTS = 'src/**/*.test.{ts,tsx}';
const SLOW = 'src/**/*.slow.test.{ts,tsx}';
const PERF = 'src/**/*.perf.test.{ts,tsx}';
type Suite = readonly [include: string, exclude: ReadonlyArray<string>];
const NORMAL: Suite = [TESTS, [SLOW, PERF]];
const SUITES: Readonly<Record<string, Suite>> = {
  slow: [SLOW, []],
  perf: [PERF, []],
  full: [TESTS, [PERF]],
};

export default defineConfig(({ mode }) => {
  const [include, exclude] = SUITES[mode] ?? NORMAL;
  return {
    // Resolve `#shared` from this file rather than through node_modules: under Stryker the
    // sandbox's node_modules is a junction back to the original tree, so the package link would
    // load the unmutated shared source.
    resolve: {
      alias: { '#shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
    },
    test: {
      name: 'app',
      include: [include],
      exclude: [...configDefaults.exclude, ...exclude],
      typecheck: {
        enabled: !UNDER_STRYKER && include === TESTS,
        include: ['src/**/*.test-d.{ts,tsx}'],
      },
    },
  };
});
