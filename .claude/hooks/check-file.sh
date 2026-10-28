#!/usr/bin/env bash
# PostToolUse hook on Edit|Write. After a .ts file changes: typecheck the project, lint the
# file, run its tests. Exit 2 hands the output back to the agent; the edit already happened.
#
#   typecheck   tsgo if installed (@typescript/native-preview), else tsc. Sub-agents see
#               only the errors in the file they touched: an error elsewhere is a sibling
#               mid-write, or the architect's problem at phase verification.
#   eslint      the one file, warnings count as errors.
#   vitest      the file's own colocated tests (<base>.test.ts(x), <base>.test-d.ts(x)). Not
#               `related`: through barrels everything is related, and siblings' red stubs
#               drown the report; the architect runs related once per phase. Skipped for
#               stubs (red by design), barrels and types.ts, and for the test-writer (its
#               tests are meant to be red; it runs them itself).
#
# Each tool runs from node_modules/.bin when it's there, else through pnpm exec. Not a policy
# hook, so it fails open: on unparseable input, and without node_modules/.bin (said once per
# agent per session as context, exit 0).
set -u

root="${CLAUDE_PROJECT_DIR:-$PWD}"
fields=$(node "$root/.claude/hooks/hook-input.cjs" tool_input.file_path agent_id agent_type 2>/dev/null) || exit 0
{ read -r path; read -r agent_id; read -r agent_type; } <<<"$fields"

case "$path" in *.ts|*.tsx|*.mts|*.cts) ;; *) exit 0 ;; esac
[[ -f "$path" ]] || exit 0
# Also fixes the drive letter: from a c:\ cwd vitest loads itself twice and every file fails at
# collection. Git Bash's cd hands children C:\. Keep this before any pnpm call.
cd "$root" || exit 0
# node_modules/.bin first: bash runs pnpm's #!/bin/sh launchers directly, and a pnpm installed as
# pnpm.cmd alone (corepack, the standalone installer) isn't on bash's PATH at all. Found when a
# missing pnpm showed as a lint failure on every edit (issue #12).
x() { if [[ -x "node_modules/.bin/$1" ]]; then "node_modules/.bin/$1" "${@:2}"; else pnpm exec "$@"; fi; }
if [[ ! -d node_modules/.bin ]]; then
  # Without an install, `pnpm exec tsc` is not a typecheck, only noise on every edit. Say so once
  # per agent per session (SessionStart clears .claude/locks; an architect's phase release can
  # only repeat the notice), as context the agent reads with no failure. Per agent, so a notice
  # the main session consumed doesn't leave a sub-agent editing unchecked and uninformed.
  marker=".claude/locks/check-file-skipped-${agent_id:-main}"
  if [[ ! -f "$marker" ]]; then
    mkdir -p .claude/locks && : > "$marker"
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"check-file: no node_modules/.bin in this project, so typecheck, lint and tests are skipped after edits. Run pnpm install, or report it."}}'
  fi
  exit 0
fi
# Repo-relative with forward slashes, which is how tsgo and eslint print paths. Normalising the
# slashes alone isn't enough on Windows: file_path and CLAUDE_PROJECT_DIR can differ in
# drive-letter case, or in /c/... against C:/... spelling, and then a prefix strip matches
# nothing and the typecheck filter below hides every error.
rel=$(node -e 'const p = require("node:path"); process.stdout.write(p.relative(process.cwd(), p.resolve(process.argv[1])).split(p.sep).join("/"))' "$path") || exit 0

report=""
failed=0
section() { report+="== $1"$'\n'"$2"$'\n'; failed=1; }

# 1. Typecheck
tsc=tsc
x tsgo --version >/dev/null 2>&1 && tsc=tsgo
if ! out=$(x "$tsc" --noEmit 2>&1); then
  [[ -n "$agent_id" ]] && out=$(grep -F -- "$rel" <<<"$out" || true)
  [[ -n "$out" ]] && section "typecheck ($tsc)" "$out"
fi

# 2. Lint
if ! out=$(x eslint --max-warnings 0 -- "$rel" 2>&1); then
  section "eslint" "$out"
fi

# 3. Tests
tests=()
case "$rel" in
  *.test.ts|*.test-d.ts|*.test.tsx|*.test-d.tsx) tests=(run "$rel") ;;
  */index.ts|*/types.ts) ;;
  *) base="${rel%.*}"
     for t in "$base.test.ts" "$base.test-d.ts" "$base.test.tsx" "$base.test-d.tsx"; do [[ -f "$t" ]] && tests+=("$t"); done
     (( ${#tests[@]} )) && tests=(run "${tests[@]}") ;;
esac
grep -q '@stub' "$path" && tests=()
[[ "$agent_type" == test-writer ]] && tests=()

if (( ${#tests[@]} )); then
  if ! out=$(x vitest "${tests[@]}" 2>&1); then
    section "vitest" "$(tail -n 80 <<<"$out")"
  fi
fi

if (( failed )); then
  printf '%s' "$report" >&2
  exit 2
fi
exit 0
