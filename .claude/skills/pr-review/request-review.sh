#!/usr/bin/env bash
# Requests one review round on a pull request, as "Requesting a review" in SKILL.md describes.
#
#   bash .claude/skills/pr-review/request-review.sh <pr number> <codex|claude> [--worktree <dir>]
#
# Counts the reviewer's markers on the PR and stops at 9. Checks that the reviewed checkout is
# exactly the PR head with a clean tree (or reviews from a detached worktree at the head, which
# is removed afterwards). Runs the reviewer in the foreground, then confirms its marker landed.
# Exit 0: the round posted. 1: a precondition or the run failed. 2: bad arguments. 3: the cap.
# A script rather than prose because the git guard refuses `$(gh auth token)` in a command.
set -u

usage() { echo "usage: request-review.sh <pr number> <codex|claude> [--worktree <dir>]" >&2; exit 2; }
[[ $# -ge 2 ]] || usage
N="$1"; R="$2"; shift 2
[[ "$N" =~ ^[0-9]+$ ]] || usage
case "$R" in codex|claude) ;; *) usage ;; esac
wt=""
if [[ $# -gt 0 ]]; then
  [[ "$1" == --worktree && $# -eq 2 ]] || usage
  wt="$2"
fi

fail() { echo "request-review: $1" >&2; exit "${2:-1}"; }

root=$(git rev-parse --show-toplevel) || fail "not inside a git repository"
count() {
  gh pr view "$N" --json reviews,comments \
    --jq "[.reviews[].body, .comments[].body] | map(select(startswith(\"<!-- ai-review: $R \"))) | length"
}
before=$(count) || fail "could not read PR #$N"
(( before < 9 )) || fail "$R has reviewed PR #$N 9 times; the cap is reached" 3
round=$((before + 1))
head=$(gh pr view "$N" --json headRefOid -q .headRefOid) || fail "could not read PR #$N's head"

dir="$root"
if [[ -n "$wt" ]]; then
  # Absolute from the start: git -C and the cd below would read a relative path differently,
  # and the cleanup must name the same directory after the cd into it.
  case "$wt" in /*|[A-Za-z]:*) ;; *) wt="$(pwd -P)/$wt" ;; esac
  [[ -e "$wt" ]] && fail "$wt already exists; give a fresh scratch path"
  git -C "$root" fetch -q origin "$head" 2>/dev/null || true
  git -C "$root" worktree add -q --detach "$wt" "$head" || fail "could not add a worktree at $wt"
  dir="$wt"
  trap 'rm -rf "$wt"; git -C "$root" worktree prune' EXIT
fi

at=$(git -C "$dir" rev-parse HEAD)
[[ "$at" == "$head" ]] || fail "the checkout is at $at, not the PR head $head. Push first, or pass --worktree <dir>."
dirty=$(git -C "$dir" status --porcelain)
[[ -z "$dirty" ]] || fail "the working tree differs from the PR head. Commit and push, or pass --worktree <dir>:
$dirty"

case "$R" in
  codex)  model="GPT-6 Astra at medium effort" ;;
  claude) model="Claude Opus at high effort" ;;
esac
prompt="You are the $R reviewer, running $model. Review pull request #$N as review $round of 9 by following \"Doing a review\" in .claude/skills/pr-review/SKILL.md exactly."
echo "request-review: $R round $round/9 on PR #$N at ${head:0:7}, from $dir"

cd "$dir" || fail "could not enter $dir"
case "$R" in
  codex)
    token=$(gh auth token) || fail "gh auth token failed; run gh auth login"
    printf '%s\n' "$prompt" |
      GH_TOKEN="$token" codex exec -m gpt-6-astra -c model_reasoning_effort=medium \
        -s workspace-write -c sandbox_workspace_write.network_access=true \
        -c shell_environment_policy.inherit=all -c shell_environment_policy.ignore_default_excludes=true -
    ;;
  claude)
    printf '%s\n' "$prompt" |
      claude -p --model opus --effort high --setting-sources user \
        --permission-mode dontAsk --no-session-persistence \
        --allowedTools Read Grep Glob "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" \
          "Bash(git rev-parse:*)" "Bash(git status:*)" "Bash(gh pr view:*)" "Bash(gh pr diff:*)" \
          "Bash(gh api:*)" "Bash(gh pr comment:*)" "Bash(pnpm exec vitest run:*)"
    ;;
esac
status=$?

after=$(count) || fail "the reviewer exited ($status), and the PR couldn't be re-read to confirm the round"
(( after > before )) || fail "the reviewer exited ($status) without posting round $round. Read its output above, fix the cause, and request again; the failed run doesn't count."
echo "request-review: $R review $round/9 posted on PR #$N"
