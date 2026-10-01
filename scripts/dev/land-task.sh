#!/usr/bin/env bash
# Architect tool: after QA passes, commit a task worktree and merge it into main.
# Usage: scripts/dev/land-task.sh <TaskID> "<conventional commit subject>"
# Discard instead (QA failed after fix round): git worktree remove --force <wt>; git branch -D task/<ID>
set -euo pipefail
ID="$1"; SUBJECT="$2"
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
WT="${WT_BASE:-/c/Users/admin/itstudio-wt}/$ID"
TRAILER="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"

git -C "$WT" add -A
git -C "$WT" commit -q -m "$SUBJECT" -m "Implemented by Codex from docs/tasks/$ID.md; reviewed by Claude (QA)." -m "$TRAILER"
git -C "$ROOT" merge -q --no-ff "task/$ID" -m "merge: task/$ID" -m "$TRAILER"
git -C "$ROOT" worktree remove --force "$WT"
git -C "$ROOT" branch -q -d "task/$ID"
git -C "$ROOT" log --oneline -3
