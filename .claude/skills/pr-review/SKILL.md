---
name: pr-review
description: How pull requests are reviewed here — by a Codex or Claude model on request, never automatically, at most 9 rounds per reviewer per PR, with the PR kept a draft until the loop is done. Covers requesting a round (request-review.sh, run by the git manager or a solo main session), doing a review (for the reviewing model), and answering one. Use this when the PR reviewer setting in CLAUDE.md is codex or claude and a PR is opened, pushed to, or has review threads to answer, and whenever you are asked to review a pull request.
---

# Pull request review

The **PR reviewer** setting in `CLAUDE.md` decides whether this applies. With `none`, skip
it: a PR goes from draft to ready to merge. With `codex` or `claude`, pull requests are
reviewed by that model on request, never automatically. GitHub Copilot isn't used.

| Reviewer | Model | How it starts |
|---|---|---|
| `codex` | GPT-6 Astra, `medium` effort, via the Codex CLI | By request, as below. |
| `claude` | Claude Opus, `high` effort, via Claude Code headless | By request, as below; also the fallback when Codex can't run. |

The model names and flags in `request-review.sh` were measured on 2026-09-22. Update them
there, and in this table, when you change them.

**A PR is opened as a draft and stays one until its review loop is complete.** CI skips
drafts (the scaffold's `ci.yml`). Marking the PR ready (`gh pr ready <n>`) starts CI, so it
runs once per PR and not once per review round.

Requested reviews run on the owner's own subscriptions (ChatGPT for Codex, Claude for
Claude Code), not on API keys. Each reviewer posts its own review to the PR with `gh`.

## Requesting a review

Request a round when the PR is opened, and again after every push that changes it. Each
reviewer reviews a PR **at most 9 times**. Every review's first line is a marker,
`<!-- ai-review: <reviewer> <n>/9 -->`, and the round is the number of markers already on
the PR plus one.

Under the orchestrator, or with a solo architect, the **git manager** requests rounds as
part of its `REVIEW` job. Anyone else with state-changing GitHub rights (a main session
with no git manager) runs the same script:

```bash
bash .claude/skills/pr-review/request-review.sh <pr number> <codex|claude> [--worktree <dir>]
```

The script counts the markers and stops at 9. It checks that the reviewed checkout is
exactly the PR's head with a clean working tree, starts the reviewer, and when the reviewer
exits, confirms that the round's marker landed. It exits non-zero, with the reason, if any
step fails. A run that fails doesn't count against the 9.

- **While agents are still working in the checkout,** pass `--worktree <dir>` with a path
  in the scratchpad. The script reviews from a detached worktree at the PR head, then
  removes it and prunes. The shared checkout is never clean mid-effort.
- **It takes minutes,** so run it in the background and wait for it to exit.
- **Codex** gets `GH_TOKEN` from `gh auth token` for that one run, because inside Codex's
  sandbox `gh` can't reach the system keyring. `workspace-write` with network on is the
  least access under which posting works.
- **Claude** runs with `--setting-sources user`, which keeps this repo's default agent and
  hooks out of the reviewer's session. `dontAsk` refuses anything not on the allow-list,
  so the reviewer can read, run vitest on a file, and talk to GitHub, but can't edit files
  or run git commands that change state.

On a large diff, each round says it isn't exhaustive. Aim each request at what the last
rounds skipped (production paths, then tests, then prose and fidelity), and reply to every
thread before the next round, which reads the replies.

## Doing a review

This part is for the reviewing model. Your request told you which reviewer you are (`codex`
or `claude`), the PR number `N`, and your round `n`.

**Post exactly one review per run, whatever you find.** A clean review is still a review:
post it, and say what you checked.

1. **Confirm what you're reviewing.** Run
   `gh pr view N --json number,title,body,baseRefName,headRefName,headRefOid` and
   `git rev-parse HEAD`. If they differ, don't review. Post a review that says the checkout
   was at `<HEAD>` and not the PR head `<headRefOid>`, and stop. Then run
   `git status --porcelain`. If it prints anything, the files you'd read and test aren't
   the PR's. Don't review: post a review that lists those paths and says the working tree
   differs from the PR, and stop. Never discard, stash or commit someone else's changes.
2. **Read, in this order:**
   - the PR title and body;
   - the diff: `gh pr diff N`, or `git diff <baseRefName>...HEAD`;
   - `CLAUDE.md`, and `.claude/skills/code-standards/SKILL.md` in full, especially its
     **Review checklist**;
   - the contribution's `review.md` and `plan.md`, in `contributions/complete/<id>/` or
     `contributions/in-progress/<id>/`, where `<id>` is the branch name without its
     `feat/`, `fix/` or `chore/` prefix, if they exist;
   - every file the diff touches, in full, and the definitions of whatever the changed
     code calls;
   - earlier rounds on this PR and the replies to them (`gh pr view N --comments`, and
     `gh api repos/{owner}/{repo}/pulls/N/comments` for inline threads), so you don't
     repeat a finding that was answered unless the answer is wrong.
3. **Judge, in priority order:**
   1. **Correctness.** Wrong results; a `throw`, an unchecked cast (`as`), or a non-null
      assertion in production code; a `Result` whose error is dropped or mislabelled;
      off-by-one; I/O that leaked into `core/`; hostile input (sizes taken from input,
      unbounded recursion, stale state after an error); and a change that is right in
      isolation but breaks a caller elsewhere.
   2. **Tests.** Does each test pin the behaviour its contract's JSDoc promises? Would it
      fail if the body were wrong? Are the edge cases and properties the contract implies
      covered? Is any test helper copied rather than imported?
   3. **Standards.** Every item on the code-standards **Review checklist**, and `CLAUDE.md`'s
      rules.
   4. **Fidelity.** Does the diff do what the PR body and `plan.md` say, and nothing they
      don't? A departure from the plan that isn't recorded under **Deviations** or
      **Decisions made mid-loop** is a finding. The plan is frozen once the contribution is
      archived to `contributions/complete/`, before the PR opens. From then on, a change
      made in answer to a review is recorded in the PR body's **Decisions to veto** and in
      the reply to the finding, never in `plan.md`. Check it there, and don't ask for it in
      the plan.
   5. **Prose.** JSDoc, `CLAUDE.md`, the agent and skill files, and the PR body say what the
      code actually does.

   Don't flag formatting or lints that `pnpm check` enforces, or matters of taste no rule
   covers. You may run `pnpm exec vitest run <file>` on a file the diff touches to confirm a
   claim. Don't run the full check or a build.

   A finding carries a severity: **P0** (breaks the build, loses data, or is unsafe),
   **P1** (wrong behaviour), **P2** (a rule broken or a test that proves nothing), or
   **P3** (worth doing, not blocking). It gives the evidence, meaning the rule it breaks or
   the input that fails, and the fix.
4. **Write the review body** in this shape:

   ~~~markdown
   <!-- ai-review: codex 3/9 -->
   ## codex review 3/9 · GPT-6 Astra (medium) · <head sha, 7 characters>

   **Verdict:** No changes required.
   <!-- or: **Verdict:** Changes suggested: 3 (P1 1, P2 1, P3 1) -->

   ### Findings
   1. **P1** `src/billing/core/total.ts:42`: what is wrong, the evidence, the fix. (inline)
   2. **P2** `src/billing/types.ts:10`: … (outside the diff; fix below)
      ```diff
      - old
      + new
      ```

   ### Checked
   - One line per area you examined and found sound, so a clean verdict says what it covers.
   ~~~

   The first line is the counting marker, exactly `<!-- ai-review: <reviewer> <n>/9 -->`.
5. **Post it as one review**, event `COMMENT`. The PR's author is usually the same GitHub
   account, and GitHub refuses approve or request-changes on your own PR. Each finding on a
   line the diff adds or keeps gets an inline comment, with a ```` ```suggestion ```` block
   when the fix is a direct replacement of those lines. `line` is the line number in the
   new file, `side` is `RIGHT`, and a multi-line suggestion adds `start_line` and
   `start_side`. A suggestion replaces exactly lines `start_line` to `line`.

   ```bash
   gh api repos/{owner}/{repo}/pulls/N/reviews --method POST --input - <<'JSON'
   {
     "commit_id": "<headRefOid>",
     "event": "COMMENT",
     "body": "<the review body>",
     "comments": [
       { "path": "src/billing/core/total.ts", "line": 42, "side": "RIGHT",
         "body": "**P1**: what is wrong and why.\n\n```suggestion\n  return ok(a + b);\n```" }
     ]
   }
   JSON
   ```

   Send the payload on stdin as shown. If your shell can't take a here-document, write the
   payload to `node_modules/.cache/review/<reviewer>-<n>.json` (ignored with
   `node_modules`) and pass that path to `--input`. With no inline findings, send
   `"comments": []`.

   GitHub rejects the **whole** review (HTTP 422) if any inline comment points at a line
   outside the diff. On a 422, move every inline finding into the body under **Findings**,
   with its fix as a ```` ```diff ```` block, and post again with `"comments": []`. If that
   fails too, post the body with `gh pr comment N --body-file -`.
6. **Finish** by printing the posted review's URL (`html_url` in the response). If nothing
   could be posted, print the error and the full review body so the requester can post it.

**Never:** edit, create or delete files outside `node_modules/.cache/review/`; commit, push,
or change branches; approve, request changes, merge, close, label, or resolve threads; post
more than once per run.

## Answering a review

This part is for the PR's author (the main session, through the git manager's `REPLY`
job), and it applies to a human reviewer's comments too. A review comment is a claim. Check
each one against the code. Fix the real ones. Reply to the rest with the reason: in the
inline thread with `gh api repos/{owner}/{repo}/pulls/N/comments/<comment id>/replies -F
body=@<file>`, or with a PR comment that quotes the finding. Then push and request the next
round.

Stop when a round brings nothing new, or when the reviewer reaches 9/9. If findings are
still open at the cap, list them in a PR comment with what was decided about each. Then
mark the PR ready (`gh pr ready <n>`) and let CI run.
