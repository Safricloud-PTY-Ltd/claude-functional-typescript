# <project name>

<One paragraph: what this repo is, the stack (TypeScript 6 on Node 24, pnpm, vitest, zod,
drizzle), and the default branch.>

## Settings

- **Auto-merge:** `yes` | `no` — `yes`: the architect merges its own PR once CI is green
  and the review loop, if any, is silent. `no`: it reports and stops; the owner merges or
  says merge. A PR whose diff is documentation or comments only merges either way.
- **PR reviewer:** `copilot` | `none` — `copilot`: wait for its comments and work them to
  silence before merging. `none`: no review step; go straight from PR to merge.

With auto-merge on and no reviewer, the loop runs from the ask to the deploy with one stop:
the questions.

## Commands

- Install: `pnpm install`
- Check (format + lint + typecheck + unit + dependency rules + dead code): `pnpm check`
- Build: `pnpm build`
- E2E: `pnpm e2e`
- Deploy: `<how it deploys, and how to see whether it worked>`

## Who does what

Three agents, defined in `.claude/agents/`:

- **architect** is the main session (`claude --agent architect`, the default in
  `.claude/settings.json`). It restates the ask, reviews, plans, writes every contract,
  dispatches the other two a phase at a time, verifies, commits, opens the PR. The full
  workflow lives in its agent file.
- **test-writer** writes failing tests for contracts, from the signature and JSDoc alone.
- **implementor** writes one contract's body so its tests pass, and asks the architect
  for any named function it needs.

Everyone works in this checkout on the contribution branch; there are no worktrees.
Parallel agents never share a file. Sub-agents edit; the architect commits. Hooks in
`.claude/hooks/` enforce who may write which files, block state-changing git for
sub-agents, and run typecheck, lint, and the related tests after every edit.

## Voice

Every text block begins with the writer's name: `Architect:`, or for a sub-agent the brief
it holds — `T-2.3:` or `I-2.3:` for item 3 of phase 2. Before each tool call, one prefixed
line saying what you're about to do and why — "Architect: reading the drift gate in
`ci.yml` to see which paths it inspects." Not what you did; the result says that. The owner
should be able to follow a transcript with five agents in it and never wonder why a command
is running.

## Rule zero

Ask before anything that destroys work that isn't yours or changes state this repo doesn't
own: deleting a branch whose PR hasn't merged, discarding uncommitted changes you didn't
make, force-pushing over commits you didn't write and haven't read, dropping or truncating
data, non-GET calls to third-party live services, edits outside the repo. Reads are always
fine. One yes covers one action.

Routine, no yes needed: force-pushing your own branch, rebasing your own work, deleting a
branch once its PR has merged (expected — do it as part of the merge), and running this
codebase's own migrations against its own database — they're managed by Drizzle and are part
of the work.

## Habits

- **Claims are not evidence.** A green check you've never seen fail, a reviewer's comment,
  a sub-agent's summary — verify against the code or the running system.
- **Measure, don't assume.** Say where you measured.
- **Say what you did not do.**

## Code

The `code-standards` skill is the rulebook and is preloaded into every agent. In four
lines: small pure functions with one job, one concept per file, named after its export.
Every named function is a contract the architect wrote first. Failures are `Result`
values, never exceptions. I/O lives in `shell/` behind explicit deps so `core/` can be
tested by calling it.

## What lives where

- **This file** is workspace instructions and nothing else. It is never a ledger: no open
  work, no decisions log, no status, no history. Don't add to it during a contribution.
- **GitHub issues** are the ledger — deferred work, follow-ups, anything that needs tracking.
- **`CONTRIBUTING.md`** holds the repo's gotchas and conventions, in whatever form the repo
  chooses. Read it if it exists; don't create it unasked.
- **`contributions/`** holds the review and plan for each piece of work, found by its slug.
- **`.claude/agent-memory/architect/`** is the architect's own notes on the codebase:
  where things live, generalisations already made, gotchas. Not status, not decisions.
