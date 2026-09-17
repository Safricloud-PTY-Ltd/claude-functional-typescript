---
name: project-scaffold
description: Sets up or repairs the toolchain that enforces this repo's code standards — TypeScript 6 config, ESLint with the functional/jsdoc/import/neverthrow rules, Prettier, Vitest with type tests and coverage, dependency-cruiser architecture rules, knip dead-code detection, lefthook git hooks, pnpm supply-chain settings, Dependabot, and GitHub Actions CI plus nightly mutation testing. Use this when creating a new repository, when `pnpm check` is missing or broken, when adding or changing any lint, typecheck, test, or CI configuration, when a tool in the chain is upgraded, or when someone asks which tool enforces a given rule.
---

# Project scaffold

The `code-standards` skill says what the code looks like. This skill installs the tools that
refuse code that doesn't. Every config in `assets/` was validated together against real
package versions (see "Versions" below); copy them as they are, then adjust with a reason.

## What each tool enforces

| Standard                                                 | Enforced by                                                        |
| :------------------------------------------------------- | :----------------------------------------------------------------- |
| Explicit types on every export                           | `tsconfig` `isolatedDeclarations`                                  |
| No `enum`, `namespace`, parameter properties             | `tsconfig` `erasableSyntaxOnly` (Node runs `src/` directly)        |
| No `let`, no classes, no `this`, no loops, no mutation   | `eslint-plugin-functional`                                         |
| No `throw`/`try` outside `shell/`, `app/`, `stub.ts`     | `functional/no-throw-statements`, `no-try-statements`, per-path    |
| Results must be handled                                  | `@ninoseki/eslint-plugin-neverthrow` `must-use-result`             |
| No named function inside a function; no `function` decl | `no-restricted-syntax` selectors in `eslint.config.js`             |
| No `enum`, no default export, no `null` literal          | `no-restricted-syntax`                                             |
| ≤150 lines/file, ≤40 lines/function, ≤3 params, cx ≤8   | core ESLint `max-lines`, `max-lines-per-function`, `max-params`, `complexity` |
| `type` over `interface`; `ReadonlyArray<T>`; `readonly` keyword | `@typescript-eslint/consistent-type-definitions`, `array-type`; `functional/readonly-type` |
| JSDoc on every export, `@param`/`@returns` described, no types in JSDoc, `@errors` allowed | `eslint-plugin-jsdoc`                    |
| Relative imports carry `.ts`; no cycles; no default exports | `eslint-plugin-import-x`                                        |
| Every directory is a module entered only through its `index.ts`, at every depth ≤5; no own-barrel imports; barrels only re-export; `core/` never imports `shell/`/`app/`; `core/` imports nothing from node_modules but neverthrow; `shared/` is a leaf; nothing imports `app/`; no cycles, orphans, or unresolvable imports; prod never imports tests | `.dependency-cruiser.cjs` |
| No unused files, exports, or dependencies                | `knip`                                                             |
| Tests red before green, type tests, coverage thresholds  | `vitest` (`typecheck.enabled`, `coverage.thresholds`)              |
| Tests that assert something                              | Stryker mutation score, nightly                                    |
| Nothing lands unformatted/unlinted/untyped               | `lefthook` pre-commit and pre-push, CI `pnpm check`                |
| Fresh/malicious package versions, install scripts        | `pnpm-workspace.yaml` `minimumReleaseAge`, `allowBuilds`           |

## Procedure for a new repository

1. Copy everything in `assets/` to the repo root, preserving paths (the `.github/`, `src/shared/`,
   and `src/app/` directories included). Rename `gitignore` to `.gitignore` on the way; it ships
   undotted because npm strips a dotted `.gitignore` out of every tarball it builds, so the
   dotted name would never survive delivery. Edit `package.json` `name`.
2. Install the toolchain. TypeScript is pinned to 6 because typescript-eslint's peer range excludes 7;
   `@typescript/native-preview` supplies `tsgo` for fast typechecks.

   ```bash
   pnpm add -D typescript@6 @typescript/native-preview @types/node \
     eslint @eslint/js typescript-eslint eslint-config-prettier prettier \
     eslint-plugin-functional eslint-plugin-jsdoc eslint-plugin-import-x \
     eslint-import-resolver-typescript @ninoseki/eslint-plugin-neverthrow \
     vitest @vitest/coverage-v8 fast-check \
     dependency-cruiser knip lefthook \
     @stryker-mutator/core @stryker-mutator/vitest-runner
   pnpm add neverthrow zod
   pnpm approve-builds --all        # lefthook and unrs-resolver need their install scripts
   pnpm exec lefthook install
   ```

   Add `drizzle-orm drizzle-zod` and `-D drizzle-kit` when the project has a database.
3. Run `pnpm check`. On the starter tree it passes with "no test files" and an empty domain list.
   If a step fails here, the environment differs from the validated one; fix the environment
   before touching the configs.
4. Fill in `CLAUDE.md`'s project paragraph and the `build`, `e2e`, and deploy commands.
   `build` and `e2e` ship as no-op placeholders; replace them when the project has something to build or run end to end.
5. Commit. The first contribution can now start with `claude --agent architect`.

## Procedure for an existing repository

Copy the configs one at a time, running the matching script after each (`pnpm lint`, `pnpm deps`,
…). Expect the dependency-cruiser and functional rules to fail on legacy code; that's information
for the architect's review, not something to silence. Turn a rule to `warn` only with a dated
comment saying which contribution turns it back to `error`.

## Decisions baked into the configs

- **`#<domain>` subpath imports, not `@/` paths.** Node 24 runs `.ts` source directly and does not
  read `tsconfig` `paths`, but it does resolve `package.json` `imports`. `"#*": "./src/*/index.ts"`
  maps `#orders` to the domain barrel and nothing else, which is exactly the cross-domain rule.
  TypeScript (`nodenext`), Vitest, ESLint's resolver, and dependency-cruiser all follow it.
- **Relative imports carry `.ts`.** Same reason: Node needs the extension. `allowImportingTsExtensions`
  and `rewriteRelativeImportExtensions` keep tsc happy now and if the project ever emits JS.
- **`noEmit` in the main tsconfig.** There is no build step; `declaration: true` exists only so
  `isolatedDeclarations` can run.
- **Config files are outside the project.** `tsconfig` includes `src` only; ESLint lints
  `*.config.{js,ts}` through `allowDefaultProject`; `.dependency-cruiser.cjs` is ignored by ESLint.
- **Tests are exempt from size and immutability rules and from `must-use-result`**, since a test
  asserts on `isOk()`/`isErr()` rather than consuming the Result.
- **`stub()` takes the contract's parameters.** `return stub('name', a, b)` keeps
  `no-unused-vars` on for real code while stubs stay clean.
- **Unused-arg rule ignores `_`-prefixed names**, for deps a shell function receives but does not use yet.
- **`pnpm-workspace.yaml` uses `allowBuilds`** (pnpm 11), not the older `onlyBuiltDependencies`.
- **Module boundaries are generated per depth.** dependency-cruiser matches paths by regex and
  can't ask the filesystem "is there an index.ts above this file", so `.dependency-cruiser.cjs`
  generates the boundary, own-barrel, and barrel-only rules for depths 1–5. Raise `MAX_DEPTH`
  there if the standards ever allow deeper trees.
- **Mutation testing is nightly only.** It is too slow for the loop; its job is to catch tests
  that pass without asserting, which shows up in the report the next morning.

## Versions

Validated on 2026-09-05 with: typescript 6.0.3, typescript-eslint 8.69, eslint 10.9,
eslint-plugin-functional 10.0, eslint-plugin-jsdoc 64.3, eslint-plugin-import-x 4.17,
eslint-import-resolver-typescript 4.4, @ninoseki/eslint-plugin-neverthrow 0.3, vitest 5.0,
dependency-cruiser 18.2, knip 6.34, prettier 3.9, lefthook 2.1, pnpm 11.25, neverthrow 8.2.
Every script in `package.json` was run green on the starter tree and on a sample domain with a
stub contract, and the dependency-cruiser and lint rules were each shown to fire on a deliberate
violation (re-verified 2026-09-17 for the nested-module rules with a four-deep tree and ten
illegal imports). Knip's config was not executed here (the validation sandbox had too little memory for
its parser); its format is the standard one and should be confirmed with `pnpm deadcode` on first
run. Stryker's config was written from its documented schema and is likewise unexecuted.

When a tool's major version changes, re-run every script, re-check the negative cases (a
`let`, a nested named function, a `throw` in core, a `core/` → `shell/` import, a cross-domain
internal import), and update this section.

## Files

```
assets/
  package.json               scripts, engines, #* imports map
  pnpm-workspace.yaml        allowBuilds, minimumReleaseAge
  tsconfig.json
  eslint.config.js
  .prettierrc.json  .prettierignore
  vitest.config.ts           typecheck on, v8 coverage with thresholds
  knip.json
  .dependency-cruiser.cjs    architecture rules
  lefthook.yml               pre-commit: prettier, eslint, typecheck; pre-push: pnpm check
  stryker.config.json
  gitignore                  copied to the root as .gitignore; includes .claude/locks/
  .github/dependabot.yml     weekly, grouped
  .github/workflows/ci.yml   pnpm check + coverage on PR and main
  .github/workflows/nightly.yml  mutation testing
  src/shared/{index,stub,brand,errors}.ts   the primitives the standards refer to
  src/app/main.ts            composition-root placeholder
```
