import { configDefaults, defineConfig } from 'vitest/config';

// Type tests run tsc over the sources. Under Stryker the sources are instrumented copies whose
// injected helpers have no type annotations, so `isolatedDeclarations` fails on every file and
// ends Stryker's dry run (measured in genesys-auth-provider, 2026-10-21). A mutant can't change
// what a type test checks, so they're off there.
const UNDER_STRYKER = process.env['STRYKER_MUTATOR_WORKER'] !== undefined;

// Three suites, told apart by file name and chosen with `vitest --mode <name>`:
//   normal  every *.test.{ts,tsx} but the two below. `pnpm test`: check, pre-push and CI.
//   slow    *.slow.test.{ts,tsx}: behaviour tests that wait on the real clock or need a raised
//           timeout. `pnpm test:slow`; CI runs them inside `pnpm coverage` (mode `full`).
//   perf    *.perf.test.{ts,tsx}: assertions on elapsed time or growth, which depend on the
//           machine. `pnpm perf`, by hand only: never in check, pre-push or CI.
// A mode is the only switch that works everywhere: an env variable in a pnpm script fails under
// cmd on Windows, and a second config that extends this one gets `include` concatenated by Vite.
// Every package's config repeats these lines; a root run passes its mode to each.
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
  // Object.hasOwn, because the mode is an outside string: `constructor` or `__proto__` would
  // otherwise fetch an inherited value that isn't a suite, and the config would throw.
  const [include, exclude] = (Object.hasOwn(SUITES, mode) ? SUITES[mode] : undefined) ?? NORMAL;
  return {
    test: {
      name: 'shared',
      // {ts,tsx}: .tsx tests are accepted; rendering JSX needs a jsx setting in tsconfig.
      include: [include],
      exclude: [...configDefaults.exclude, ...exclude],
      // Type tests belong to the normal suite; a slow or perf run has none to check.
      typecheck: {
        enabled: !UNDER_STRYKER && include === TESTS,
        include: ['src/**/*.test-d.{ts,tsx}'],
      },
    },
  };
});
