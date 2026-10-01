#!/usr/bin/env bash
# PreToolUse hook on Bash, filtered to `git *` by the `if` rule in settings.json.
# Sub-agents edit; the architect commits. State-changing git is blocked for any
# sub-agent; the main session is untouched. Fails closed on unparseable input.
set -u

root="${CLAUDE_PROJECT_DIR:-$PWD}"
fields=$(node "$root/.claude/hooks/hook-input.cjs" agent_id tool_input.command 2>/dev/null) \
  || { echo "guard-git: could not parse hook input; command blocked" >&2; exit 2; }
{ read -r agent_id; read -r cmd; } <<<"$fields"
[[ -z "$agent_id" ]] && exit 0

mutating='add|am|apply|branch|checkout|cherry-pick|clean|commit|fetch|merge|mv|pull|push|rebase|reset|restore|revert|rm|stash|switch|tag|worktree'
if grep -Eq "(^|[^[:alnum:]_./-])git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?($mutating)([[:space:]]|$)" <<<"$cmd"; then
  echo "guard-git: sub-agents edit; the architect commits. Read-only git (status, diff, log, show, grep, blame) is fine. Put what you changed in your report." >&2
  exit 2
fi
exit 0
