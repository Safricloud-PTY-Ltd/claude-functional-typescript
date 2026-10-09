#!/usr/bin/env bash
# PreToolUse hook on every Bash command (git and gh can hide behind cd, a pipe or a wrapper, so
# there is no `if` filter). The policy lives in git-policy.cjs: the main session is untouched,
# the git manager runs git and gh with one fence around main, an architect also gets `add` and
# `commit` on files in its own territory, and every other sub-agent gets read-only git and gh.
# This wrapper fails closed: anything but a clean allow or a reasoned block is a block.
set -u

root="${CLAUDE_PROJECT_DIR:-$PWD}"
node "$root/.claude/hooks/git-policy.cjs"
status=$?
case "$status" in
  0|2) exit "$status" ;;
  *)   echo "guard-git: the git policy failed to run (exit $status); command blocked" >&2; exit 2 ;;
esac
