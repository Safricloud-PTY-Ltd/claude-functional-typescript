#!/usr/bin/env bash
# Requests one review round on a pull request, as "Requesting a review" in SKILL.md describes.
#
#   bash .claude/skills/pr-review/request-review.sh <pr number> <codex|claude>
#
# Counts the reviewer's markers on the PR and stops at 9. Checks that the checkout is exactly
# the PR head with a clean tree: the review runs here, never in a worktree (owner's rule,
# 2026-10-28), so everything is committed and pushed before a round and nothing is written
# until it has posted. Runs the reviewer in the foreground, then confirms its marker landed.
# With two reviewers configured, one copy of this script runs per reviewer, at the same time.
# Exit 0: the round posted. 1: a precondition or the run failed. 2: bad arguments. 3: the cap.
# A script rather than prose because the git guard refuses `$(gh auth token)` in a command.
set -u

usage() { echo "usage: request-review.sh <pr number> <codex|claude>" >&2; exit 2; }
[[ $# -eq 2 ]] || usage
N="$1"; R="$2"
[[ "$N" =~ ^[0-9]+$ ]] || usage
case "$R" in codex|claude) ;; *) usage ;; esac

fail() { echo "request-review: $1" >&2; exit "${2:-1}"; }

# Model, effort and speed per role come from .claude/settings.json `env` (CLAUDE.md, Models).
# Checked before any git or gh work, so a config mistake fails first and costs nothing.
case "$R" in
  codex)  model="${CODEX_REVIEW_MODEL:-gpt-6-astra}"; effort="${CODEX_REVIEW_EFFORT:-medium}"; tier="${CODEX_REVIEW_TIER:-}" ;;
  claude) model="${CLAUDE_REVIEW_MODEL:-opus}"; effort="${CLAUDE_REVIEW_EFFORT:-high}"; tier="" ;;
esac
if [[ "$R" == codex && -n "${CODEX_ALLOWED_MODELS:-}" ]]; then
  [[ ",${CODEX_ALLOWED_MODELS// /}," == *",$model,"* ]] \
    || fail "codex model $model isn't allowed here; CODEX_ALLOWED_MODELS (.claude/settings.json env) is $CODEX_ALLOWED_MODELS"
fi
# Codex accepts an unknown service_tier silently (measured 2026-10-28); an unknown effort it rejects itself.
case "$tier" in ''|default|fast|ultrafast) ;; *) fail "CODEX_REVIEW_TIER is $tier; Codex accepts any value silently, so only default, fast and ultrafast are allowed here" ;; esac
# Guarded expansion: bash 3.2 (macOS) treats a plain "${tierflag[@]}" on an empty array as unbound under set -u.
tierflag=(); [[ -n "$tier" ]] && tierflag=(-c "service_tier=$tier")

# The project root is where this script is installed (<project>/.claude/skills/pr-review/), not
# the repository's top level: a project nested in a larger repository (<repo>/web) reviews from
# the project directory (issue #12). CLAUDE_PROJECT_DIR can't be used, since it is set for hooks
# but not for Bash tool commands (measured 2026-10-28).
dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && { pwd -W 2>/dev/null || pwd -P; }) || fail "could not resolve the project root"
count() {
  gh pr view "$N" --json reviews,comments \
    --jq "[.reviews[].body, .comments[].body] | map(select(startswith(\"<!-- ai-review: $R \"))) | length"
}
before=$(count) || fail "could not read PR #$N"
(( before < 9 )) || fail "$R has reviewed PR #$N 9 times; the cap is reached" 3
round=$((before + 1))
head=$(gh pr view "$N" --json headRefOid -q .headRefOid) || fail "could not read PR #$N's head"

at=$(git -C "$dir" rev-parse HEAD)
[[ "$at" == "$head" ]] || fail "the checkout is at $at, not the PR head $head. Commit and push first; the review runs in this checkout."
dirty=$(git -C "$dir" status --porcelain)
[[ -z "$dirty" ]] || fail "the working tree differs from the PR head. Commit everything (memory notes included) and push first; the review runs in this checkout:
$dirty"

payload="node_modules/.cache/review/pr$N-$R-$round"
prompt="You are the $R reviewer, running $model at $effort effort${tier:+, $tier speed}; your review header names it as \`$model ($effort)\`. Your payload file is $payload.json. Review pull request #$N as review $round of 9 by following \"Doing a review\" in .claude/skills/pr-review/SKILL.md exactly."
echo "request-review: $R round $round/9 on PR #$N at ${head:0:7}, from $dir ($model, $effort${tier:+, $tier})"

# A failed earlier attempt at this round would otherwise be read back in by the reviewer.
rm -f "$dir/$payload.json" "$dir/$payload.md"
cd "$dir" || fail "could not enter $dir"
case "$R" in
  codex)
    token=$(gh auth token) || fail "gh auth token failed; run gh auth login"
    printf '%s\n' "$prompt" |
      GH_TOKEN="$token" codex exec -m "$model" -c "model_reasoning_effort=$effort" ${tierflag[@]+"${tierflag[@]}"} \
        -s workspace-write -c sandbox_workspace_write.network_access=true \
        -c shell_environment_policy.inherit=all -c shell_environment_policy.ignore_default_excludes=true -
    ;;
  claude)
    printf '%s\n' "$prompt" |
      claude -p --model "$model" --effort "$effort" --setting-sources user \
        --permission-mode dontAsk --no-session-persistence \
        --allowedTools Read Grep Glob "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" \
          "Bash(git rev-parse:*)" "Bash(git status:*)" "Bash(gh pr view:*)" "Bash(gh pr diff:*)" \
          "Bash(gh api:*)" "Bash(gh pr comment:*)" "Bash(pnpm exec vitest run:*)" \
          "Edit(node_modules/.cache/review/**)" "Edit(./node_modules/.cache/review/**)"
    ;;
esac
status=$?

after=$(count) || fail "the reviewer exited ($status), and the PR couldn't be re-read to confirm the round"
(( after > before )) || fail "the reviewer exited ($status) without posting round $round. Read its output above, fix the cause, and request again; the failed run doesn't count."
echo "request-review: $R review $round/9 posted on PR #$N"
