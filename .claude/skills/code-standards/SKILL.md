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

Every directory under `src/` is a module, and a module's `index.ts` is its only door.
Modules nest: a domain is a module that contains modules, which may contain modules, down
to five directories below `src/` (enforced).

```
src/
  shared/                  module: primitives any other module may use — Brand, stub(), Unexpected
    index.ts
  <domain>/                module: one business area — orders, billing, auth, ...
    index.ts               the domain's public API. Re-exports only. Architect-owned.
    types.ts               domain types, error unions, zod schemas, ports (Deps)
    core/                  module: the functional core — pure functions only
      <concept>/           module: pricing/, validation/, ... nesting as deep as the concept needs
        index.ts           what the concept exposes; hides representation and helpers
        index.test.ts      black-box test through the barrel: what a replacement must pass
        <fn>.ts            one primary export, named after the file
        <fn>.test.ts       its contract tests, colocated
    shell/                 module: the imperative shell — I/O behind ports
      <adapter>/           module per external thing: db/, http/, clock/, mail/
        index.ts           exports the real adapter and its in-memory fake
        fake.ts            the fake; same port, no I/O; used by every test that needs the port
  app/                     composition root: parses env, builds Deps, wires shell into core
```

- A file is named after its primary export: `lineTotal.ts` exports `lineTotal`.
  `camelCase.ts` for functions, `PascalCase.ts` never (no classes).
- One primary export per core file. A private helper may live in the same file when the
  architect puts it there; it is still a contract, with JSDoc and a `@stub` marker.
- New files and new directories are architect decisions. Implementors and test-writers
  don't create them (enforced); they report what they need.
- Tests live beside the code they cover. Type-level tests use `<fn>.test-d.ts`.

## Modules

A module is a boundary with something behind it. It earns its directory by hiding one of
three things; a directory that hides none of them is a file, not a module.

- **A representation.** The module exports an opaque branded type and the functions that
  make, read, and combine it; callers never see the shape. `Money` is a `Brand<number, 'Money'>`
  today and could be `bigint` tomorrow without a caller changing. Transparent records are for
  boundary DTOs and for types whose shape _is_ the contract, never for a module's own data.
- **A dependency.** Third-party packages and node builtins are imported only inside `shell/`
  adapter modules; `core/` may import `neverthrow` and nothing else from outside `src/`
  (enforced). Swapping drizzle, the HTTP client, or the mailer is one module's diff.
- **A choice of implementation.** A port with a real adapter and an in-memory fake, or an
  algorithm with a plausible alternative. The fake is mandatory for every port: writing it is
  what proves the port doesn't leak the real implementation, and tests use it instead of mocks.

The architect's test for a proposed module: _if this were swapped for another
implementation, what would change on the other side?_ If nothing, there is no boundary to
draw.

- The barrel is the contract. It is written first, as a contract like any function, and it
  contains only re-exports (enforced). What the barrel doesn't export doesn't exist outside.
- Ports are function types declared by the consumer, in the domain's `types.ts`, never by
  the adapter. The adapter module exports `<name>` (real) and `fake<Name>` (fake) satisfying
  the same type.
- Every module has an `index.test.ts` that imports only from `./index.ts`. It is the
  acceptance suite a replacement would have to pass, and it may not know anything the barrel
  doesn't say.
- Reach: from outside a module, only its `index.ts` (enforced at every depth). Inside a
  module, files import each other relatively, and a nested module may import from its
  ancestors' files, because it is inside them. Sibling modules reach each other only through
  their barrels.

## Imports

- Inside a module: relative paths with the extension, `./lineTotal.ts`, `../types.ts`. The
  extension is not optional: Node runs the source directly and needs it.
- Into another module: its `index.ts` and nothing deeper (enforced at every depth). For a
  top-level module use the subpath alias — `import { lineTotal } from '#orders'`;
  `#<name>` resolves to `src/<name>/index.ts` and to nothing else.
- `shared/` is imported as `#shared` from anywhere. `shared/` imports nothing from domains.
- A module never imports its own barrel (enforced). Barrels import nothing from outside
  their own directory (enforced).
- `core/` never imports `shell/` or `app/`; `shell/` may import its domain's `core/`
  barrel; `app/` may import anything; nothing imports `app/` (enforced).
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
- One `index.test.ts` per module, importing only from `./index.ts`, exercising the barrel as
  a caller would. Ports are exercised through the module's fake, never a mock.
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
- [ ] Core imports nothing from shell, app, or node_modules (neverthrow aside); other modules are
      reached only through their `index.ts`; module-owned data is opaque.
- [ ] Tests cover every `@param` edge case and every `@errors` kind; no mocks in core.
- [ ] `tsc --noEmit`, `eslint`, and the file's tests pass; nothing outside the brief was touched.
