---
name: project-scaffold
description: Sets up or repairs the toolchain that enforces this repo's code standards — TypeScript 6 config, ESLint with the functional/jsdoc/import/neverthrow rules, Prettier, Vitest with type tests and coverage, dependency-cruiser architecture rules, knip dead-code detection, lefthook git hooks, pnpm supply-chain settings, Dependabot, and GitHub Actions CI plus mutation testing run by hand. Use this when creating a new repository, when `pnpm check` is missing or broken, when adding or changing any lint, typecheck, test, or CI configuration, when a tool in the chain is upgraded, or when someone asks which tool enforces a given rule.
---

# Project scaffold

The `code-standards` skill says what the code looks like. This skill installs the tools that
refuse code that doesn't. Every config in `assets/` was validated together against real
package versions (see "Versions" below); copy them as they are, then adjust with a reason.

## What each tool enforces

| Standard                                                                                                                                                                                                                                                                                                                                               | Enforced by                                                                                |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| Explicit types on every export                                                                                                                                                                                                                                                                                                                         | `tsconfig` `isolatedDeclarations`                                                          |
| No `enum`, `namespace`, parameter properties                                                                                                                                                                                                                                                                                                           | `tsconfig` `erasableSyntaxOnly` (Node runs each package's `src/` directly)                  |
| No `let`, no classes, no `this`, no loops, no mutation                                                                                                                                                                                                                                                                                                 | `eslint-plugin-functional`                                                                 |
| No `throw`/`try` outside `shell/`, `app/`, `stub.ts`                                                                                                                                                                                                                                                                                                   | `functional/no-throw-statements`, `no-try-statements`, per-path                            |
| Results must be handled                                                                                                                                                                                                                                                                                                                                | `@ninoseki/eslint-plugin-neverthrow` `must-use-result`                                     |
| No named function inside a function; no `function` decl                                                                                                                                                                                                                                                                                                | `no-restricted-syntax` selectors in `eslint.config.js`                                     |
| No `enum`, no default export, no `null` literal                                                                                                                                                                                                                                                                                                        | `no-restricted-syntax`                                                                     |
| ≤150 lines/file, ≤40 lines/function, ≤3 params, cx ≤8                                                                                                                                                                                                                                                                                                  | core ESLint `max-lines`, `max-lines-per-function`, `max-params`, `complexity`              |
| `type` over `interface`; `ReadonlyArray<T>`; `readonly` keyword                                                                                                                                                                                                                                                                                        | `@typescript-eslint/consistent-type-definitions`, `array-type`; `functional/readonly-type` |
| JSDoc on every export, `@param`/`@returns` described, no types in JSDoc, `@errors` allowed                                                                                                                                                                                                                                                             | `eslint-plugin-jsdoc`                                                                      |
| Relative imports carry `.ts`; no cycles; no default exports                                                                                                                                                                                                                                                                                            | `eslint-plugin-import-x`                                                                   |
| Every directory in a package's `src/` is a module entered only through its `index.ts`, at every depth ≤5; no own-barrel imports; barrels only re-export; `core/` never imports `shell/`/`app/`; `core/` imports nothing from node_modules but neverthrow and `#shared`; `shared` is a leaf; a package imports no other package but `shared`, and that only through its barrel; nothing imports a package's `src/app/`; no cycles, orphans, or unresolvable imports; prod never imports tests | `.dependency-cruiser.cjs`                                                                  |
| No unused files, exports, or dependencies                                                                                                                                                                                                                                                                                                              | `knip`                                                                                     |
| Tests red before green, type tests, coverage thresholds                                                                                                                                                                                                                                                                                                | `vitest` (`typecheck.enabled`, `coverage.thresholds`)                                      |
| A test that depends on the clock or the machine can't refuse a push: slow tests run in CI only, perf tests by hand only | `vitest --mode` (`slow`, `perf`, `full`) in each package's `vitest.config.ts`; `pnpm test:slow`, `pnpm perf`, `pnpm coverage` |
| Tests that assert something                                                                                                                                                                                                                                                                                                                            | Stryker mutation score, by hand                                                            |
| Nothing lands unformatted/unlinted/untyped                                                                                                                                                                                                                                                                                                             | `lefthook` pre-commit and pre-push, CI `pnpm check`                                        |
| Fresh/malicious package versions, install scripts                                                                                                                                                                                                                                                                                                      | `pnpm-workspace.yaml` `minimumReleaseAge`, `allowBuilds`                                   |

## Procedure for a new repository

1. Copy everything in `assets/` to the repo root, preserving paths (the `.github/` and
   `packages/` directories included). Rename `gitignore` to `.gitignore` and `gitattributes` to
   `.gitattributes` on the way; `gitignore` ships undotted because npm strips a dotted
   `.gitignore` out of every tarball it builds, so the dotted name would never survive
   delivery, and `gitattributes` follows suit. Replace `<project-name>` with the project's
   name in the three manifests, the root's `name` and the packages' `@<project-name>/…` scope
   (`sed -i.bak 's/<project-name>/myproj/g' package.json packages/*/package.json && rm package.json.bak packages/*/package.json.bak`;
   `-i.bak` works with GNU and BSD sed), and set
   `packageManager` to the pnpm you use (`pnpm pkg set packageManager=pnpm@$(pnpm --version)`);
   CI's `pnpm/action-setup` reads it.
2. Install the toolchain. TypeScript is pinned to 6 because typescript-eslint's peer range excludes 7;
   `@typescript/native-preview` supplies `tsgo` for fast typechecks. The repo is a pnpm
   workspace, so the toolchain goes to the root with `-w` (pnpm refuses a root `add` without
   it) and runtime dependencies go to the package that imports them, with `--filter`.

   ```bash
   pnpm add -Dw typescript@6 @typescript/native-preview @types/node \
     eslint @eslint/js typescript-eslint eslint-config-prettier prettier \
     eslint-plugin-functional eslint-plugin-jsdoc eslint-plugin-import-x \
     eslint-import-resolver-typescript @ninoseki/eslint-plugin-neverthrow \
     vitest @vitest/coverage-v8 fast-check \
     dependency-cruiser knip lefthook \
     @stryker-mutator/core @stryker-mutator/vitest-runner
   pnpm --filter @myproj/shared add neverthrow
   pnpm --filter @myproj/app add neverthrow zod
   pnpm approve-builds --all        # lefthook and unrs-resolver need their install scripts
   pnpm exec lefthook install
   ```

   Add `drizzle-orm drizzle-zod` (and `-D drizzle-kit`) to the package that has a database,
   and add all three to that workspace's `ignoreDependencies` in `knip.json` until knip finds
   them on its own (an import for the first two, a drizzle config for the CLI), for the
   reason `neverthrow` and `zod` are there for `packages/app` (installed before any code
   imports them). `esbuild`, which drizzle-kit pulls in, is already in
   `allowBuilds` as `false` (its binary is an optional dependency; the script only validates),
   and drizzle-kit's old `@esbuild-kit/core-utils` esbuild is already overridden.

3. Run `pnpm check` and `pnpm coverage`. On the starter tree both pass, with four test files
   in `packages/shared/src/` (`errors.test.ts`; `index.test.ts`, the barrel's acceptance test
   that every module has; and the type tests `brand.test-d.ts` and `index.test-d.ts`) and an
   empty domain list. Knip prints two configuration hints and exits 0: `lefthook` (see
   Versions) and `packages/app`'s entry patterns, which match nothing until its first domain.
   If a step fails here, the environment differs from the validated one; fix the environment
   before touching the configs.
4. Fill in `CLAUDE.md`'s project paragraph and the `build`, `e2e`, and deploy commands.
   `build` and `e2e` ship as no-op placeholders; replace them when the project has something to build or run end to end.
5. Commit. The first effort can now start with `claude` (the orchestrator), or `claude --agent architect` for a solo architect.

## Procedure for an existing repository

Copy the configs one at a time, running the matching script after each (`pnpm lint`, `pnpm deps`,
…). Expect the dependency-cruiser and functional rules to fail on legacy code; that's information
for the architect's review, not something to silence. Turn a rule to `warn` only with a dated
comment saying which contribution turns it back to `error`.

## Decisions baked into the configs

- **A pnpm workspace under `packages/`.** Each package is `packages/<name>/` with its own
  `package.json`, `vitest.config.ts` and `src/`. `packages/shared` holds what every package
  uses, and `packages/app` is the application, with its composition root at `src/app/` and
  its domains beside it. A second deployable (a web front end, an MCP server) is another
  package beside `app`, with its own `src/app/`. The root run covers them all: vitest
  `projects`, one tsconfig over `packages/*/src`, knip `workspaces`, and dependency-cruiser
  over `packages`. Packages talk only through `shared`: the cross-package rules refuse an
  import of any other package, and an import of `shared` past its barrel.
- **`#<domain>` subpath imports, not `@/` paths.** Node 24 runs `.ts` source directly and does not
  read `tsconfig` `paths`, but it does resolve `package.json` `imports`. In each package,
  `"#*": "./src/*/index.ts"` maps `#orders` to the domain barrel and nothing else, which is
  exactly the cross-domain rule. `"#shared": "@<project-name>/shared"` comes first and maps to
  the shared package, whose `exports` is its barrel. TypeScript (`nodenext`), Vitest, ESLint's
  resolver, and dependency-cruiser all follow both.
- **`#shared` is aliased in the vitest config of every package that imports it** (today
  `packages/app`'s; shared's needs none). Under Stryker the sandbox's `node_modules` is a
  junction back to the original tree, so the workspace link would load the unmutated shared
  source. The alias resolves it from the config file instead.
- **Adding a package** copies `packages/app`'s shape: a `package.json` with the `"#shared"`
  and `"#*"` imports and an `"@<project-name>/shared": "workspace:*"` dependency, a
  `vitest.config.ts` with the alias and the suite lines (below), and a `knip.json` workspace.
  The root configs already glob `packages/*`, and ESLint's default-project cap is raised for
  their config files.
- **Three test suites, chosen by vitest mode.** Each package's `vitest.config.ts` is a function
  of the mode. With none it runs the normal suite: every `*.test.{ts,tsx}` except the next two.
  `--mode slow` runs only `*.slow.test.{ts,tsx}`, `--mode perf` only `*.perf.test.{ts,tsx}`,
  and `--mode full` the normal and slow suites together. Any other mode is the normal suite, so
  a misspelt mode runs the wrong tests without saying so. The root run passes its mode to every
  project, and a file can be run alone in its mode (`vitest run --mode slow <file>`).
  - `pnpm test` (and so `pnpm check`, pre-push and CI's check step) is the normal suite.
  - `pnpm coverage` is mode `full`. That is where CI runs the slow suite, once, and it lets
    code only a slow test reaches count toward the thresholds.
  - `pnpm test:slow` and `pnpm perf` run one suite each. No hook and no workflow runs
    `pnpm perf`.
  - Mutation testing stays on the normal suite, so Stryker reports every mutant in code only a
    slow test reaches as `NoCoverage`, and each counts against the score. One such function
    took the starter tree from 100 to 60, under the `break` threshold, so `pnpm mutation`
    exited 1. Cover the logic with a normal test (a fake clock, a smaller input) where the
    contract allows one. A wall-clock test is a perf test now, which keeps it out of
    Stryker's sandbox, where it would fail (see Versions).
  - A mode, because the alternatives fail: an env variable in a pnpm script doesn't work under
    cmd on Windows, and a second config that `extends` the first gets its `include`
    concatenated with the first's by Vite.
  - Every package's config repeats the suite lines. A package whose config lacks them runs its
    slow and perf tests in every `pnpm check`.
  - A project bootstrapped before the suites gets the hooks and the agents' rules with a
    `--force` upgrade, but not these configs. Copy four things from `assets/`: the `test:slow`,
    `perf` and `coverage` scripts, the suite lines into each package's `vitest.config.ts`, the
    `no-own-barrel` lookahead, and the comments in `ci.yml` and `lefthook.yml`. Until then a
    test named `*.slow.test.ts` or `*.perf.test.ts` still runs in `pnpm test`.
  - The file names still end in `.test.ts`, so ESLint's test relaxations, coverage's and
    Stryker's excludes and knip treat them as tests. `no-own-barrel` exempts a module's
    `index.slow.test.ts` and `index.perf.test.ts` as it does `index.test.ts`.
- **A designer's folder is outside the format check.** `.prettierignore` lists
  `contributions/**/design`: the designer agent writes its pages and notes there, runs no
  formatter, and publishes the pages as they are. Without the line a design folder fails
  `prettier --check .`, and so `pnpm check` and the pre-push hook (measured in a scratch
  project, 2026-11-10). A project bootstrapped before the designer gets the agent with a
  `--force` upgrade but not this line, because the upgrade copies `.claude/` and
  `CLAUDE.md` only. The main session checks for it before it spawns a designer and adds it; a
  designer run alone tells the owner to.
- **dependency-cruiser generates depth 0 too.** A package's `src/` is itself a module, so
  `packages/shared/src/index.ts` is a depth-0 barrel and keeps the barrel-only and
  own-barrel rules.
- **Relative imports carry `.ts`.** Same reason: Node needs the extension. `allowImportingTsExtensions`
  and `rewriteRelativeImportExtensions` keep tsc happy now and if the project ever emits JS.
- **`noEmit` in the main tsconfig.** There is no build step; `declaration: true` exists only so
  `isolatedDeclarations` can run.
- **Config files are outside the project.** `tsconfig` includes `packages/*/src` only; ESLint
  lints `*.config.{js,ts}` and `packages/*/*.config.ts` through `allowDefaultProject`;
  `.dependency-cruiser.cjs` is ignored by ESLint. Knip ignores `.claude/**`, because its
  vitest plugin would otherwise take the vendored scaffold's own test files as the root
  workspace's.
- **Tests are exempt from size and immutability rules and from `must-use-result`**, since a test
  asserts on `isOk()`/`isErr()` rather than consuming the Result.
- **`stub()` takes the contract's parameters.** `return stub('name', a, b)` keeps
  `no-unused-vars` on for real code while stubs stay clean.
- **Unused-arg rule ignores `_`-prefixed names**, for deps a shell function receives but does not use yet.
- **`pnpm-workspace.yaml` uses `allowBuilds`** (pnpm 11), not the older `onlyBuiltDependencies`.
- **Module boundaries are generated per depth.** dependency-cruiser matches paths by regex and
  can't ask the filesystem "is there an index.ts above this file", so `.dependency-cruiser.cjs`
  generates the boundary, own-barrel, and barrel-only rules for depths 0–5 (0 is a package's
  `src/` itself). Raise `MAX_DEPTH`
  there if the standards ever allow deeper trees.
- **Mutation testing runs by hand.** It is too slow for the loop and too slow for a schedule
  nobody reads, so `nightly.yml` has no schedule: dispatch it when you want the score. Its job
  is to catch tests that pass without asserting.

## Versions

Validated on 2026-09-05 with: typescript 6.0.3, typescript-eslint 8.69, eslint 10.9,
eslint-plugin-functional 10.0, eslint-plugin-jsdoc 64.3, eslint-plugin-import-x 4.17,
eslint-import-resolver-typescript 4.4, @ninoseki/eslint-plugin-neverthrow 0.3, vitest 5.0,
dependency-cruiser 18.2, knip 6.34, prettier 3.9, lefthook 2.1, pnpm 11.25, neverthrow 8.2.
Every script in `package.json` was run green on the starter tree and on a sample domain with a
stub contract, and the dependency-cruiser and lint rules were each shown to fire on a deliberate
violation (re-verified 2026-09-17 for the nested-module rules with a four-deep tree and ten
illegal imports). Knip's config was first executed on 2026-10-01 (knip 6.39) on a freshly bootstrapped
Windows project: `neverthrow` and `zod` are in `ignoreDependencies` because the starter tree
installs them before any code imports them, and `dot` (Graphviz, for `deps:graph`) is in
`ignoreBinaries`; an unused file is still reported. Stryker's config was first executed on
2026-10-12 (Stryker 10.0, pnpm 11), on a project of 780 mutated files, and needed three changes.
Under pnpm's isolated layout, Stryker can't discover `@stryker-mutator/vitest-runner` by itself,
so `plugins` names it. The initial test run of a large suite outlasts the default five-minute
`dryRunTimeoutMinutes`, so it is 30. And a test that asserts wall-clock time fails in
Stryker's instrumented sandbox and nowhere else; since 2026-11-10 it is a perf test, which
Stryker's run doesn't collect. A test that reads source files as text fails there too: make it
skip itself under mutation, or keep it out of the run with a Stryker-only vitest config
(`vitest.configFile` in `stryker.config.json`).

Re-validated downstream on 2026-10-28 (genesys-alerts-manager, a fresh bootstrap) with eslint
10.13, typescript-eslint 8.72, eslint-plugin-jsdoc 65.4.2 (adds `jsdoc/escape-inline-tags`;
the negative cases above all still refused), dependency-cruiser 18.7, knip 6.43, lefthook 2.2,
Stryker 10.1, pnpm 11.25. That bootstrap found six asset defects fixed in issue #14 (the
barrel acceptance test refused by `no-own-barrel`, no `src/shared/index.test.ts` in the
starter tree, `eslint.config.js` past its own `max-lines`, `stryker.config.json` not
prettier-formatted, the vendored `.claude/` failing `format:check`, `.pnpm-store/`
untracked). Measured here the same day: with `lefthook.yml` present, knip
6.43.0 still reports `lefthook` as an unused devDependency when it leaves
`ignoreDependencies`, so it stays there.

Re-validated on 2026-10-31 (genesys-billing-manager, a fresh bootstrap with drizzle; then
these assets bootstrapped again in a scratch project) with knip 6.44.0, eslint 10.13, vitest
5.0.5, pnpm 11.25. Three changes came of it:
- **`neverthrow` leaves `ignoreDependencies`.** The starter tree's `src/shared/index.test.ts`
  imports it, and knip is clean without the entry.
- **`lefthook` stays, and here is why.** Knip's Lefthook plugin counts `lefthook` as used only
  while lefthook's git hooks are installed in `.git/hooks`. In a checkout with them, knip
  prints the hint "Remove from ignoreDependencies" (a hint, exit 0). Without them (a fresh
  clone, a failed `lefthook install`) it reports an unused devDependency and fails. Measured
  both ways in one repo by moving the hooks aside. So the hint is not a reason to remove it.
- **Type tests and audit overrides.** `knip.json` lists `src/**/*.test-d.{ts,tsx}` as
  entries, because knip's vitest plugin reads only `test.include`, not `typecheck.include`,
  and would report every type test as unused. The starter tree gains `Brand` type tests. A
  fresh bootstrap's `pnpm audit` shows 7 advisories, 1 high, all in dev tooling. The
  `overrides` in `pnpm-workspace.yaml` (`qs`, `deepmerge-ts`, drizzle-kit's esbuild) take it
  to 1 moderate (`minimatch` under eslint, left alone; the file says why), with and without
  drizzle installed. `drizzle-kit generate` wrote a correct migration under them.
- **Workflow actions.** `actions/checkout@v7`, `pnpm/action-setup@v6`,
  `actions/setup-node@v7` and `actions/upload-artifact@v7`, which are the four bumps Dependabot
  opened on day one downstream. Each one's PR CI passed there, and a dispatched nightly
  passed with all four, the artifact upload included. `pnpm/action-setup@v6` also ends the
  Node 20 deprecation warning that v4 printed.

Moved to a pnpm workspace on 2026-11-03 (genesys-action-editor, at the owner's request). The
starter tree's `src/shared` and `src/app` became `packages/shared/src` and
`packages/app/src/app`, after genesys-auth-provider's workspace, which had run under these
tools since 2026-10-16. Measured twice: in genesys-action-editor, and by bootstrapping
these assets in a fresh scratch project with this procedure (pnpm 11.25.0, eslint 10.14,
typescript-eslint 8.72.1, vitest 5.0.5, knip 6.44.1, dependency-cruiser 18.7.1, Stryker
10.1.1). In both:
- Every script exits 0: 4 test files, 9 tests, depcruise over 16 modules, 100% coverage,
  and a mutation score of 100.
- In the scratch project, `lefthook install` failed (`lefthook.exe` was missing from a store
  under the temp dir, as on 2026-10-31). Knip still reported nothing for `lefthook` there.
- Downstream, each new rule refused a deliberate violation: another package's domain,
  `shared` past its barrel, `shared` importing `app`, and a domain importing `src/app/`.
- A sample domain whose `core/` imports `#shared` passed lint, depcruise, vitest and a run
  under Node (`#orders` → `#shared`).

Three test suites added on 2026-11-10, after genesys-auth-provider, which split a perf suite
out on 2026-11-09 after a slow jsdom test refused three pushes under the suite's own load. The
slow suite and mode `full` are new here. Measured in one place only: a scratch project on
Windows made by copying these assets and installing the toolchain without lefthook (vitest
5.1.0, knip 6.44, dependency-cruiser 18.7, eslint 10.14, Stryker 10.1.1, pnpm 11.24), with a
slow test, a perf test and a barrel-level `index.slow.test.ts` planted in `packages/shared`.
- `vitest list` collected the 4 starter files with no mode, the 2 slow files with
  `--mode slow`, the perf file with `--mode perf`, and the starter and slow files (6) with
  `--mode full`, each through the root config's `projects`.
- One file ran alone in its mode. The same slow file with no mode exited 1 with "No test files
  found", which is why the per-edit hook gives slow and perf tests no vitest run.
- `pnpm check` passed with the three files present; `pnpm coverage` ran 6 files at 100%; knip
  reported nothing for them.
- dependency-cruiser refused `index.slow.test.ts` (`no-own-barrel-0`) before the lookahead
  changed, and passed after.
- `pnpm mutation` scored 100, and its dry run ran the normal suite's 3 tests only.
- A `.tsx` slow test and a `.tsx` perf test planted in `packages/app` were each collected in
  their own mode only, and the slow one ran alone by file.
- `process.env.NODE_ENV` was `test` in every mode; only `import.meta.env.MODE` changed.
- Modes `constructor`, `__proto__` and `toString` threw a TypeError from the suite lookup
  until it used `Object.hasOwn`; with it, each ran the 4 normal files, as a misspelt mode does.
  `assets.test.cjs`, beside `assets/`, pins the table for both configs under node with a
  stubbed `vitest/config`; change the suite lines and it must still pass.
- A function reached only by a slow test: 2 mutants, both `NoCoverage`, score 60, exit 1.

Not measured: Linux, and the CI workflow itself.

When a tool's major version changes, re-run every script, re-check the negative cases (a
`let`, a nested named function, a `throw` in core, a `core/` → `shell/` import, a cross-domain
internal import, an import of another package, an import of `shared` past its barrel), and
update this section.

## Files

```
assets/
  package.json               the workspace root: scripts, engines; no dependencies of its own
  pnpm-workspace.yaml        packages/*, allowBuilds, minimumReleaseAge, audit overrides for dev tooling
  tsconfig.json              one program over packages/*/src
  eslint.config.js
  .prettierrc.json  .prettierignore
  vitest.config.ts           projects: packages/*; v8 coverage with thresholds across them
  knip.json                  one workspace per package
  .dependency-cruiser.cjs    architecture rules
  lefthook.yml               pre-commit: prettier, eslint, typecheck (skipped while territories are live); pre-push: pnpm check (the normal test suite only)
  stryker.config.json
  gitignore                  copied to the root as .gitignore; includes .claude/locks/ and .claude/territories/
  gitattributes              copied to the root as .gitattributes; LF everywhere, so hooks run on Windows
  .github/dependabot.yml     weekly, grouped
  .github/workflows/ci.yml   pnpm check + coverage (which runs the slow suite) on PR and main; never the perf suite
  .github/workflows/nightly.yml  mutation testing
  packages/shared/package.json      @<project-name>/shared; exports its barrel
  packages/shared/vitest.config.ts  the shared project; the normal, slow and perf suites by mode; type tests off under Stryker
  packages/shared/src/{index,stub,brand,errors}.ts   the primitives the standards refer to
  packages/shared/src/errors.test.ts  keeps coverage green on the starter tree
  packages/shared/src/index.test.ts   the barrel's acceptance test; also pins that a module's
                                      own index.test.ts may import its barrel (no-own-barrel exempts it)
  packages/shared/src/brand.test-d.ts  type tests for Brand's nominal separation (2026-10-31)
  packages/shared/src/index.test-d.ts  the barrel's type-level acceptance test (Brand re-export)
  packages/app/package.json         @<project-name>/app; #shared and #* imports, start script
  packages/app/vitest.config.ts     the app project; the same suites; aliases #shared for Stryker
  packages/app/src/app/main.ts      composition-root placeholder
```
