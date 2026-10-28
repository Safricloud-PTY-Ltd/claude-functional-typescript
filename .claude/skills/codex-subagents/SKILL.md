---
name: codex-subagents
description: How an architect runs test-writer and implementor briefs on Codex (a GPT model via the Codex CLI) instead of Claude sub-agents, when CLAUDE.md's Sub-agents setting is `codex` — writing the brief and its allowed-files list, starting runs in the background, waiting, reading the file check, answering NEEDS/CLARIFY by resuming the same Codex session, and verifying. Use this for every test-writer or implementor brief when that setting is codex; with `claude`, start the Claude agents as usual.
---

# Codex sub-agents

When `CLAUDE.md`'s **Sub-agents** setting is `codex`, test-writers and implementors run on Codex (model: `CODEX_SUBAGENT_MODEL`, default `gpt-6-astra`),
through `codex-subagent.cjs` in this directory. Architects stay Claude. Everything in your agent
file about briefs, phases, T-then-I, NEEDS/CLARIFY/BLOCKED answers, verification and commits
still holds; only the way a brief is dispatched changes.

## What is different from a Claude sub-agent

- **No hooks.** Codex runs outside `.claude/hooks/`: no territory write-guard, no file locks, no
  post-edit typecheck/lint. The wrapper replaces the guard with a **file check**: it hashes every
  file before the run and, when the run ends, lists every changed file as `ok` (in the brief's
  allowed list) or `CHECK` with its likely owner. It never reverts anything.
- **It can't commit.** Codex's sandbox keeps `.git` read-only, and the prompt forbids state-changing
  git. You commit, as before.
- **It runs in the background**: start and resume it with the Bash tool's `run_in_background`,
  and it survives your tool call. It is not detached: a detached runner has no console to hand
  down, and on Windows a console window flashed on every brief; the foreground launcher ran a
  real brief with no window (2026-10-28). `wait` blocks up to nine minutes per call and can be
  called again; exit 3 means still
  running, exit 4 means the run's process died (its Bash task was killed) with no result, so
  start a fresh brief or resume it.

## Dispatching a brief

1. Write the brief to `<scratchpad>/<workstream>/codex/<brief id>/in/brief.md`, in the usual format
   (`Brief T-<ws>-<phase>.<item> — …`, contract, files to write, files to read, invariants, exact
   validation commands). Name every file it may create or edit in `in/allowed.txt`, one
   repo-relative path per line. The run directory is `<scratchpad>/<workstream>/codex/<brief id>/run`
   (it must not exist yet).
2. Start **one brief per Bash call**, and never chain several `start`s (or a `start` with
   anything else) in one command: the owner is asked to approve a compound Codex command even in
   bypass-permissions mode. **Run a phase's briefs concurrently**: start every T brief of the
   phase, one `start` per Bash call, back to back, then `wait` on each run in turn; the same for
   the I briefs. Concurrent briefs must never share a file (the file check attributes a change
   to the concurrent brief that was allowed it). A Codex run takes minutes, and its own
   validation seconds, so serial runs are where a loop's time goes: one effort's phase of four
   serial test-writer briefs took 18 minutes (2026-10-21).

   ```bash
   node .claude/skills/codex-subagents/codex-subagent.cjs start test-writer <ws> "<dir>/in/brief.md" "<dir>/in/allowed.txt" "<dir>/run" medium
   ```

   with `run_in_background: true` on that Bash call (`start` blocks until codex exits). Then,
   in its own Bash call:

   ```bash
   node .claude/skills/codex-subagents/codex-subagent.cjs wait "<dir>/run"   # exit 3 = still running; call again
   ```

   Effort: `medium` by default; `high` for a brief you'd call hard. Use a Bash timeout of 600000 on
   `wait`.
3. Read the report: the **Files changed** list first, then Codex's own report. Every `CHECK` line is
   yours to resolve before you go on:
   - `allowed to concurrent brief …` — another of your own runs wrote it; confirm in that report.
   - `in <ws>'s territory` — almost always a sibling architect's agent; leave it.
   - `STRAY` (your territory, not allowed) or `RESERVE` — Codex wrote outside its brief. Read the
     diff. Keep it only if it's correct and you'd have allowed it (record a deviation); otherwise
     undo it with Edit (never `git checkout`), and resume the run telling it why.
4. **NEEDS / CLARIFY / BLOCKED**: answer exactly as you would a Claude sub-agent, then resume the
   same Codex session so it keeps its context:

   ```bash
   node $W resume "<dir>/run" "<dir>/in/answer-1.md"   # the answer, as text
   node $W wait "<dir>/run"
   ```

5. **Verify yourself, always**: run the brief's validation commands and, because no hook ran,
   `pnpm exec tsgo --noEmit | grep -F src/<domain>/` and `pnpm exec eslint --max-warnings 0 <paths>`
   on the files it touched. Then the usual phase verification and your commit.

## Notes

- **Each run starts cold.** A standing rule told to one run is unknown to the next: put every
  permission the brief grants in the brief itself, every time (most often: "you may add the
  imports the body needs"; four of nineteen implementor runs stopped on its absence).

- **Codex can read only inside this repo.** Its sandbox is the checkout: a path in another
  repository or in the scratchpad is unreadable, and the agent either asks or writes something
  plausible from the contract alone. Inline any outside fact a brief needs (a reference file's
  relevant part, a measured value) into the brief itself, verbatim. Gitignored files inside the
  repo (`private-fixtures/`, `.cache/`) are readable. A "run it against the real asset" check on
  anything outside the repo is yours to do by hand.

- Codex gets your brief, its role file (`.claude/agents/test-writer.md` or `implementor.md`),
  `CLAUDE.md` and the code-standards skill, in that order. Briefs must name every file to read,
  as before; it has no memory of earlier briefs.
- Never point two concurrent briefs at the same file.
- If `wait` reports `no final message`, read `run/stderr-<n>.log`; a quota or rate-limit error
  there means stop dispatching and report it to the orchestrator.
- Every artefact (prompt, events, report) stays in the run directory for the archive's sake;
  nothing of it is committed.
