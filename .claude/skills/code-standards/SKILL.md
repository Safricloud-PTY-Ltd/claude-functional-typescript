---
name: code-standards
description: The coding standards for this repository — functional TypeScript, one concept per file, contracts before code, Result types instead of exceptions, functional core / imperative shell, the directory and import rules, the JSDoc contract format, and the test conventions. Use this whenever you write, plan, review, test, or implement any TypeScript in this repo, including contracts, stubs, barrels, tests, refactors, and one-line fixes. If you are about to create or edit a .ts file and have not read this, read it first.
---

# Code standards

Code in this repo is written by several agents working in parallel from contracts the
architect wrote first. The rules below exist so that files written by different agents,
without talking to each other, still compose into one coherent codebase — and so that
every rule that can be checked by a tool is checked by a tool (tsc, eslint, dependency-cruiser,
knip, vitest). Where a rule says "enforced", a hook or CI will reject the violation; don't
argue with it, report it to the architect if you think it's wrong.

## Layout

```
src/
  shared/                  primitives any domain may use: brand types, stub(), Unexpected
    index.ts               shared's barrel; other code imports `#shared`, never a file inside
  <domain>/                one business area: orders, billing, auth, ...
    index.ts               the domain's public API. Re-exports only. Architect-owned.
    types.ts               domain types, error unions, zod schemas, Deps (ports)
    core/                  functional core — pure functions only
      <concept>/           optional single grouping level: pricing/, validation/, ...
        <fn>.ts            one primary export, named after the file
        <fn>.test.ts       its tests, colocated
    shell/                 imperative shell — I/O behind explicit deps
      <adapter>/           db/, http/, fs/, clock/, ...
        <fn>.ts
  app/                     composition root: parses env, builds deps, wires shell into core
```

- Maximum depth is five directories below `src/`. If you need a sixth, the domain is too
  big; split it.
- A file is named after its primary export: `lineTotal.ts` exports `lineTotal`.
  `camelCase.ts` for functions, `PascalCase.ts` never (no classes).
- One primary export per core file. A private helper may live in the same file when the
  architect puts it there; it is still a contract, with JSDoc and a `@stub` marker.
- New files and new directories are architect decisions. Implementors and test-writers
  don't create them (enforced); they report what they need.
- Tests live beside the code they cover. Type-level tests use `<fn>.test-d.ts`.

## Imports

- Inside a domain: relative paths with the extension, `./lineTotal.ts`, `../types.ts`. The
  extension is not optional: Node runs the source directly and needs it.
- Across domains: only through the domain barrel, via the subpath alias —
  `import { lineTotal } from '#orders'`. `#<domain>` resolves to `src/<domain>/index.ts` and to
  nothing else, so there is no way to reach another domain's internals (enforced).
- `shared/` is imported as `#shared` from anywhere. `shared/` imports nothing from domains.
- A domain never imports its own barrel (enforced); inside the domain, paths are relative.
- `core/` never imports `shell/` or `app/`. `shell/` may import its own domain's `core/`.
  `app/` may import anything. (enforced)
- No barrels below the domain root. `index.ts` exists once per domain and contains only
  `export { ... } from './...'` lines.
- `import type { ... }` for types. No default exports. No circular imports (enforced).

## Functions

- `export const name = (params): ReturnType => { ... }`. Every exported function has
  explicit parameter and return types; `isolatedDeclarations` makes this a compile error
  otherwise, which is intended: the signature is the contract.
- Up to three parameters. Beyond that, one options object with named fields.
- Inputs are read-only: `ReadonlyArray<T>`, `Readonly<T>`, `readonly` fields. Never
  mutate an argument or a captured value — build new values (`{ ...a, b }`, `toSorted`,
  `with`, `map`/`filter`/`reduce`).
- `const` only. No `let`, no `var`, no `class`, no `this`, no `enum`, no `namespace`, no
  parameter properties (`erasableSyntaxOnly` rejects the last three so Node can run the
  source directly).
- No boolean flag parameters. A flag means two functions.
- One level of abstraction per function. A function either orchestrates calls to other
  functions or does one piece of work itself, not both.
- Target under 40 lines per function and under 150 per file. The limits are lint rules;
  hitting them is a signal to extract, not to disable the rule.
- Naming: functions are verbs (`computeTotal`, `parseOrder`), predicates start with `is`/`has`,
  constructors start with `make`/`to`, types are nouns.
- Every named function is a contract the architect wrote. An implementor writes the body of
  the contract it holds and declares no functions of its own — no `const f = () =>`, no
  `function f`, no private helper, however small. Inline lambdas passed straight to `map`,
  `filter`, `reduce`, `toSorted`, `andThen` and the like are expressions, not functions, and
  are fine. A function you want to name is a NEEDS report to the architect, who reuses one
  that exists, generalises one that almost does, or writes a new stub.

## Types

- `type` over `interface`. Discriminated unions with a `kind` field over inheritance.
- IDs and other primitives that must not be mixed are branded:
  `type OrderId = string & { readonly __brand: 'OrderId' }` with a `toOrderId` constructor
  in the domain's `types.ts`.
- `as const` for literal tables; `satisfies` for typed config objects.
- No `any`. `unknown` only at the edge, immediately narrowed by a zod parse.
- No type assertions (`as T`) in core. The two allowed places: right after a zod parse in
  shell, and test fixtures.
- Absence is `T | undefined`, never `null`. Drizzle returns `null`; the shell converts it.

## Errors

Core never throws. A function that can fail returns `Result<T, E>` from `neverthrow`
(`ok`, `err`); async shell functions return `ResultAsync<T, E>`. Callers must handle the
Result (enforced by `eslint-plugin-neverthrow`).

- Error values are plain, frozen, serialisable objects with a `kind` discriminant:
  `type InvalidDiscount = { readonly kind: 'InvalidDiscount'; readonly discount: number }`.
  Each domain declares its error union in `types.ts` and a small constructor per kind
  (`invalidDiscount(d)`), so error shapes are decided once.
- A function's error type names exactly the kinds it can produce, not the whole domain
  union. Wide error types hide which failures a caller must consider.
- The shell edge is the only place exceptions exist. Wrap them at the boundary with
  `ResultAsync.fromPromise(p, toUnexpected)` or `Result.fromThrowable(fn, toUnexpected)`;
  `Unexpected` (in `shared/`) is the kind for failures nobody planned for.
- No `try`/`catch` in core. No `throw` anywhere except `shared/stub.ts` and shell adapters
  converting a foreign API.

## Contracts

The architect writes a contract for every function before any implementation exists. A
contract is the exported signature, its JSDoc, and a stub body. Contracts are the interface
between agents, so their format is fixed:

```ts
import { type Result } from 'neverthrow';
import { stub } from '#shared';
import type { LineItem, Minor, InvalidDiscount } from '../../types.ts';

/**
 * Computes the total of the line items after a fractional discount.
 *
 * @param items - Line items to total. May be empty, in which case the total is 0.
 * @param discount - Fraction to remove, in [0, 1]. 0 means no discount.
 * @returns The discounted total in minor units, rounded half-up.
 * @errors InvalidDiscount - when `discount` is outside [0, 1].
 * @remarks Pure. O(n) in `items`.
 */
export const lineTotal = (
  items: ReadonlyArray<LineItem>,
  discount: number,
): Result<Minor, InvalidDiscount> => {
  // @stub 2.3
  return stub('lineTotal', items, discount);
};
```

- The summary line says what the function computes, in one sentence.
- Every parameter gets `@param` with its constraints and edge cases (empty, zero, bounds).
- `@returns` describes the ok value. `@errors` lists one line per error kind with the
  condition that produces it. Types are never repeated in JSDoc; TypeScript has them.
- `@remarks` carries anything the implementor must know that the types don't say: purity,
  complexity, rounding, ordering guarantees.
- `// @stub <phase>.<item>` is the first line of the body and names the brief that will
  implement it. `stub()` throws `NotImplemented`; that is the only way a stub may fail. The
  contract's parameters are passed through so the unused-variable rule stays on for real code.
  The implementor deletes the marker line and the `stub` import when it implements the body.
  The marker is how hooks recognise a file that is open for implementation (enforced).
- Implementors change the body and nothing else: not the signature, the JSDoc, the
  imports, or the tests, and they add no functions. If any of those needs to change, that's
  a report to the architect, not an edit.

## Shell and dependencies

- Effects are functions that take their dependencies first:
  `export const saveOrder = (deps: OrderDeps) => (order: Order): ResultAsync<OrderId, SaveFailed> => ...`.
  `OrderDeps` is a read-only object of function types declared in the domain's `types.ts`.
  This is the whole dependency-injection story; there is no container.
- Clock, randomness, environment, and network are deps, never module-level imports in
  domain code: `now: () => Date`, `randomId: () => string`.
- Data entering the system is parsed with zod at the shell (`schema.parse` or `safeParse`
  mapped into a Result). After that point the types are trusted; core does not re-validate.
- Drizzle is used only under `shell/db/`. Table schemas derive their zod schemas with
  `drizzle-zod`; a shape is declared once.
- `app/` parses `process.env` once into a typed `Env` and builds every `Deps` object from
  it. Nothing else reads `process.env`.

## Tests

- One test file per contract, colocated, `describe(fnName)` at the top level.
- Tests are written from the contract, not the implementation. The test-writer reads the
  signature and JSDoc and nothing else.
- Each `@param` edge case and each `@errors` kind gets at least one `it`. Assert on the
  Result: `expect(lineTotal([], 0)).toEqual(ok(0))`, `expect(r.isErr()).toBe(true)`.
- When the contract states an invariant (idempotent, order-independent, bounded, inverse of
  another function), add a `fast-check` property.
- Generic or conditional signatures get a `.test-d.ts` with `expectTypeOf`.
- Core tests use no mocks; pure functions don't need them. Shell tests pass fake deps as
  plain objects. Module mocking (`vi.mock`) is not used.
- A test's name states the behaviour: `it('returns InvalidDiscount when discount is above 1')`.
  Names like `works` or `handles edge case` are rejected in review.

## JSDoc and comments

- Every export has JSDoc in the contract format above. Private helpers get a one-line
  summary if their name doesn't say it all.
- Comments explain why, never what. If a comment describes what the next line does, the
  line needs a better name instead.
- No commented-out code, no TODOs in committed code. Open work is a GitHub issue.

## Review checklist

Before reporting a file done, check it against this list; the architect will.

- [ ] File named after its primary export; one primary export; under 150 lines.
- [ ] Every export has explicit types and contract-format JSDoc; no `@stub` left behind.
- [ ] No `let`, `class`, `enum`, `any`, `null`, `throw`, `try`, mutation, or default export.
- [ ] No function declared by an implementor; every named function has a contract.
- [ ] Failure paths return `Result`/`ResultAsync` with a narrow, named error type.
- [ ] Core imports nothing from shell or app; cross-domain imports go through `@/<domain>`.
- [ ] Tests cover every `@param` edge case and every `@errors` kind; no mocks in core.
- [ ] `tsc --noEmit`, `eslint`, and the file's tests pass; nothing outside the brief was touched.
