# claude-functional-typescript

A scaffold for building functional TypeScript with Claude Code, delivered by one command.

It is not a library and not an application. It is the harness — three agents, a set of write
guards, and two skills — that turns Claude Code into a team that writes contracts first,
tests second, and implementations last, in a codebase where failures are values and I/O is
kept at the edge.

## Quick start

In a new or existing project directory:

```bash
npx github:Safricloud-PTY-Ltd/claude-functional-typescript
claude --agent architect
```

That is the whole install. It writes `CLAUDE.md` and `.claude/` and touches nothing else.

```
npx github:Safricloud-PTY-Ltd/claude-functional-typescript [directory] [--force]

  directory   Where to write. Defaults to the current directory.
  --force     Overwrite files that already exist. Without it they are left alone.
```

Re-running is safe: existing files are kept, and the report tells you how many were skipped.
Pass `--force` to pull in a newer version of the harness. It only ever touches the paths it
installed, so your `src/` is never at risk — but note that `CLAUDE.md` is one of those paths,
and `--force` will overwrite the project description you filled in. Commit before you use it.

Requires **Node 24+**. The command has no dependencies and no build step, so it runs in a
few seconds.

## What lands in your project

```
CLAUDE.md                     your project's instructions to Claude — fill in the placeholders
.claude/
  settings.json               registers the hooks and makes architect the default agent
  agents/                     architect, test-writer, implementor
  hooks/                      write guard, git guard, post-edit typecheck/lint/test
  skills/
    code-standards/           the rulebook: how every function, type, and test is written
    project-scaffold/         the toolchain, plus the configs it installs, in assets/
```

Nothing else is copied. The scaffold's own working files — this README, `bin/`,
`package.json`, and any architect memory — stay here.

## How the workflow works

Three agents, defined in [.claude/agents/](.claude/agents/), with a deliberate split: one
decides, two write.

- **architect** is the session you talk to. It restates the ask, reads the code, writes a
  review and a plan, and writes a **contract** — a signature, its JSDoc, and a stub body —
  for every function before any of them exist. It dispatches the other two, verifies what
  comes back, and commits. It never writes a function body.
- **test-writer** turns a contract into failing tests, working from the signature and JSDoc
  alone. If it cannot derive a test, that is a gap in the contract, and it says so rather
  than guessing.
- **implementor** writes one contract's body until its tests pass. It cannot change the
  signature, the JSDoc, or the tests, and it declares no functions of its own — a function
  it wants is a question back to the architect.

Work runs in phases: leaves first, then the functions that call them. Within a phase, agents
run in parallel because the architect gave them files that don't overlap. Tests are written
and confirmed red before any implementation starts, so a passing test is evidence.

Each piece of work gets an id (`<yyyy-mm-dd>-<slug>`) that names its branch and its directory
under `contributions/`, holding a review for you to read and a plan with the call graph and
the phases.

### The guards

Hooks in [.claude/hooks/](.claude/hooks/) enforce what prose cannot. They give each file at
most one owner per phase, block state-changing git for sub-agents, and run typecheck, lint,
and the file's related tests after every single edit. An agent that strays gets stopped by
the harness rather than caught in review.

## The standards

The full rulebook is [code-standards](.claude/skills/code-standards/SKILL.md). The short
version:

- Small pure functions, one concept per file, the file named after its export.
- `core/` is pure and holds the logic; `shell/` holds the I/O behind explicit dependencies;
  `app/` is the composition root. `core/` may not import `shell/`.
- Failures are `Result` values from `neverthrow`, never exceptions. Error types are
  discriminated unions naming exactly the failures a function can produce.
- No `let`, no classes, no loops, no mutation, no `any`, no `null`, no default exports.
- Cross-domain imports go through a domain barrel via `#<domain>` subpath imports, so a
  domain's internals are unreachable from outside it.

Every one of those is enforced by a tool — TypeScript, ESLint, dependency-cruiser, knip, or
Vitest — not by review. The [project-scaffold](.claude/skills/project-scaffold/SKILL.md)
skill installs that toolchain and documents which tool enforces which rule.

## Working on this repo

The scaffold is the product, so everything here is payload that will land in someone else's
project. Two things follow from that:

- **`bin/cli.mjs` is plain JavaScript on purpose.** npm installs this package under
  `node_modules`, where Node refuses to strip TypeScript types
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a `.ts` file cannot be a bin. Staying
  JavaScript keeps the command a single file with no build step and no dependencies.
- **`assets/gitignore` has no dot.** npm strips `.gitignore` out of every tarball it builds,
  so a dotted name would silently never reach anyone. The `project-scaffold` skill renames it
  on the way in, and `assets/gitattributes` beside it, which forces LF so the bash hooks
  survive a Windows checkout with `core.autocrlf`.
- **`.claude/hooks/hook-input.cjs` is CommonJS on purpose.** The scaffold's `package.json`
  (and this repo's) says `"type": "module"`; as a `.js` file it would load as ESM, `require`
  would be undefined, and every guard would fail closed, blocking all git and all sub-agent
  writes.

To test a change to the command before it is on `main`, install from the branch:

```bash
npx github:Safricloud-PTY-Ltd/claude-functional-typescript#<branch> ../somewhere-empty
```

Architect memory lives in `.claude/agent-memory/` and is deliberately kept out of git here,
so this repo's notes never ship. In a project bootstrapped from the scaffold it is ordinary
committed content, shared with the team.

## Status

Early and moving. The harness and the standards are in use; the toolchain in
`project-scaffold/assets/` is validated config by config but has not yet been run end to end
from a fresh bootstrap, so expect to fix things on first use. Open work is tracked in
[issues](https://github.com/Safricloud-PTY-Ltd/claude-functional-typescript/issues).
