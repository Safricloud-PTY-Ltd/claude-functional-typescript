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
- **It runs in the background**, hidden, and survives your tool call; `wait` blocks up to nine
  minutes per call and can be called again.

## Dispatching a brief

1. Write the brief to `<scratchpad>/<workstream>/codex/<brief id>/in/brief.md`, in the usual format
   (`Brief T-<ws>-<phase>.<item> — …`, contract, files to write, files to read, invariants, exact
   validation commands). Name every file it may create or edit in `in/allowed.txt`, one
   repo-relative path per line. The run directory is `<scratchpad>/<workstream>/codex/<brief id>/run`
   (it must not exist yet).
2. Start every brief of the phase in one Bash call, then wait on each:

   ```bash
   W=.claude/skills/codex-subagents/codex-subagent.cjs
   node $W start test-writer <ws> "<dir>/in/brief.md" "<dir>/in/allowed.txt" "<dir>/run" medium
   # … one start per brief …
   node $W wait "<dir>/run"     # prints the report; exit 3 = still running, call wait again
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

- Codex gets your brief, its role file (`.claude/agents/test-writer.md` or `implementor.md`),
  `CLAUDE.md` and the code-standards skill, in that order. Briefs must name every file to read,
  as before; it has no memory of earlier briefs.
- Never point two concurrent briefs at the same file.
- If `wait` reports `no final message`, read `run/stderr-<n>.log`; a quota or rate-limit error
  there means stop dispatching and report it to the orchestrator.
- Every artefact (prompt, events, report) stays in the run directory for the archive's sake;
  nothing of it is committed.
