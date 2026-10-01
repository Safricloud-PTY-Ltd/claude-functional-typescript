#!/usr/bin/env bash
# PreToolUse hook on Edit|Write. Decides who may write which file.
#
#   main session (no agent_id)  unrestricted; the architect owns everything
#   test-writer                 only *.test.ts / *.test-d.ts under src/, beside an existing contract
#   implementor                 only existing files under src/ that carry an @stub marker,
#                               or a file it already holds; never tests, never new files
#   any file                    at most one owner per phase (.claude/locks; the architect
#                               clears it before each phase, SessionStart clears it too)
#
# Exit 2 blocks the write and hands the message to the agent as the reason.
# Fails closed: if the input can't be parsed, the write is blocked.
set -u

root="${CLAUDE_PROJECT_DIR:-$PWD}"
fields=$(node "$root/.claude/hooks/hook-input.cjs" agent_id agent_type tool_input.file_path 2>/dev/null) \
  || { echo "guard-writes: could not parse hook input; write blocked" >&2; exit 2; }
{ read -r agent_id; read -r agent_type; read -r path; } <<<"$fields"

[[ -z "$agent_id" || -z "$path" ]] && exit 0
case "$agent_type" in
  implementor|test-writer) ;;
  *) exit 0 ;;   # Explore and other sub-agents follow the normal permission flow
esac

deny() { printf 'guard-writes: %s\n' "$1" >&2; exit 2; }

# Windows hands over backslashed paths; compare with forward slashes.
root="${root//\\//}"
path="${path//\\//}"
rel="${path#"$root"/}"
[[ "$rel" == src/* ]] || deny "$agent_type may only write under src/ (asked for $rel). Put the need in your report."

is_test=0
case "$rel" in *.test.ts|*.test-d.ts) is_test=1 ;; esac

if [[ "$agent_type" == test-writer ]]; then
  (( is_test )) || deny "test-writer writes only *.test.ts and *.test-d.ts files (asked for $rel)."
  case "$rel" in
    *.test-d.ts) contract="${rel%.test-d.ts}.ts" ;;
    *)           contract="${rel%.test.ts}.ts" ;;
  esac
  [[ -f "$root/$contract" ]] || deny "no contract at $contract for $rel. Tests go beside an existing contract; report CLARIFY if the brief points elsewhere."
else
  (( is_test )) && deny "implementor does not edit tests (asked for $rel). A test that contradicts the contract is a BLOCKED report."
  [[ -f "$path" ]] || deny "implementor does not create files (asked for $rel). Report the function you need under Needs."
fi

lockdir="$root/.claude/locks"
mkdir -p "$lockdir"
lock="$lockdir/${rel//\//__}"

if [[ -f "$lock" ]]; then
  [[ "$(cat "$lock")" == "$agent_id" ]] || deny "$rel is owned by another agent this phase. Report the overlap under Blocked on."
  exit 0
fi

if [[ "$agent_type" == implementor ]] && ! grep -q '@stub' "$path"; then
  deny "$rel has no @stub marker, so it is not open for implementation. Implemented files, barrels, and types are the architect's."
fi

printf '%s' "$agent_id" > "$lock"
exit 0
