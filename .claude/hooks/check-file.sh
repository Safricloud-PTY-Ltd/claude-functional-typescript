#!/usr/bin/env bash
# PostToolUse hook on Edit|Write. After a .ts file changes: typecheck the project, lint the
# file, run its tests. Exit 2 hands the output back to the agent; the edit already happened.
#
#   typecheck   tsgo if installed (@typescript/native-preview), else tsc. Sub-agents see
#               only the errors in the file they touched: an error elsewhere is a sibling
#               mid-write, or the architect's problem at phase verification.
#   eslint      the one file, warnings count as errors.
#   vitest      the file's own tests, or the tests that import it. Skipped for stubs (red
#               by design), barrels and types.ts (everything imports them), and for the
#               test-writer (its tests are meant to be red; it runs them itself).
#
# Requires pnpm. Not a policy hook, so it fails open on unparseable input.
set -u

root="${CLAUDE_PROJECT_DIR:-$PWD}"
fields=$(node "$root/.claude/hooks/hook-input.cjs" tool_input.file_path agent_id agent_type 2>/dev/null) || exit 0
{ read -r path; read -r agent_id; read -r agent_type; } <<<"$fields"

case "$path" in *.ts|*.tsx|*.mts|*.cts) ;; *) exit 0 ;; esac
[[ -f "$path" ]] || exit 0
rel="${path#"$root"/}"
cd "$root" || exit 0

report=""
failed=0
section() { report+="== $1"$'\n'"$2"$'\n'; failed=1; }

# 1. Typecheck
tsc=tsc
pnpm exec tsgo --version >/dev/null 2>&1 && tsc=tsgo
if ! out=$(pnpm exec "$tsc" --noEmit 2>&1); then
  [[ -n "$agent_id" ]] && out=$(grep -F -- "$rel" <<<"$out" || true)
  [[ -n "$out" ]] && section "typecheck ($tsc)" "$out"
fi

# 2. Lint
if ! out=$(pnpm exec eslint --max-warnings 0 -- "$rel" 2>&1); then
  section "eslint" "$out"
fi

# 3. Tests
tests=()
case "$rel" in
  *.test.ts|*.test-d.ts) tests=(run "$rel") ;;
  */index.ts|*/types.ts) ;;
  *)                     tests=(related --run --passWithNoTests "$rel") ;;
esac
grep -q '@stub' "$path" && tests=()
[[ "$agent_type" == test-writer ]] && tests=()

if (( ${#tests[@]} )); then
  if ! out=$(pnpm exec vitest "${tests[@]}" 2>&1); then
    section "vitest" "$(tail -n 80 <<<"$out")"
  fi
fi

if (( failed )); then
  printf '%s' "$report" >&2
  exit 2
fi
exit 0
