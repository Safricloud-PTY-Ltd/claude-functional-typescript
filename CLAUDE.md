# <project name>

<One paragraph: what this repo is, the stack (TypeScript 6 on Node 24, pnpm, vitest, zod,
drizzle), and the default branch.>

## Settings

- **Auto-merge:** `yes` | `no` — `yes`: the architect merges its own PR once CI is green
  and the review loop, if any, is silent. `no`: it reports and stops; the owner merges or
  says merge. A PR whose diff is documentation or comments only merges either way.
- **PR reviewer:** `codex` | `claude` | `none` — `codex` or `claude`: requested when the PR
  is opened and after every push that changes it, at most 9 times per reviewer per PR, and
  posts its own review. Work every review to silence before merging. How to request one,
  how the reviewer does one, and how to answer it: the `pr-review` skill. `none`: no review
  step; go straight from PR to CI to merge.

PRs open as drafts and stay drafts until the review loop is done; CI skips drafts, so it
runs once, when the PR is marked ready.

With auto-merge on and no reviewer, the loop runs from the ask to the deploy with one stop:
the questions.

## Commands

- Install: `pnpm install`
- Check (format + lint + typecheck + unit + dependency rules + dead code): `pnpm check`
- Build: `pnpm build`
- E2E: `pnpm e2e`
- Deploy: `<how it deploys, and how to see whether it worked>`

## Who does what

Five agents, defined in `.claude/agents/`:

- **orchestrator** is the main session (`claude`, the default in `.claude/settings.json`).
  It splits the ask into workstreams, gives each a territory (files no other agent writes),
  spawns one architect per workstream in waves, keeps the shared files, asks the owner each
  wave's questions in one round, routes cross-territory requests, and runs the full check.
  When the owner has a choice to make, it asks with `AskUserQuestion`, options with the
  recommendation first, never a list to answer by typing.
- **git-manager** does every state-changing git and GitHub operation except architects'
  own commits: the branch, the main session's commits, the archive, push, the PR, review
  threads, CI, merge, issues. The main session spawns one per effort and sends it jobs.
- **architect** owns the shape of the code in its workstream: it restates the ask,
  reviews, plans, writes every contract, dispatches the other two a phase at a time,
  verifies, and commits its own files. `claude --agent architect` runs one solo as the main
  session, taking the work through to the merge with a git manager.
- **test-writer** writes failing tests for contracts, from the signature and JSDoc alone.
- **implementor** writes one contract's body so its tests pass, and asks the architect
  for any named function it needs.

Each agent's full workflow lives in its agent file. Everyone works in this checkout on the
effort's branch; there are no worktrees. Parallel agents never share a file. Sub-agents
edit; architects commit their own files; the git manager does the rest of git. Hooks in
`.claude/hooks/` enforce who may write which files (territories included), limit each
sub-agent's git and gh to what its role allows, and run typecheck, lint, and the related
tests after every edit.

## Voice

Every text block begins with the writer's name: `Orchestrator:`, `Git manager:`,
`Architect:` (or `Architect billing:` for a workstream), or for a sub-agent the brief it
holds — `T-2.3:` or `I-2.3:` for item 3 of phase 2, `T-billing-2.3:` under the
orchestrator. Before each tool call, one prefixed
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
