#!/usr/bin/env bash
# Architect tool: run one ROADMAP task with Codex in an isolated git worktree.
# Usage: scripts/dev/run-task.sh <TaskID> [extra instruction]
# Why worktrees: Codex's Windows sandbox cannot write to the repo under Desktop (see docs/reports/overnight-2026-10-02.md ENV-1);
# worktrees under $WT_BASE are writable and also isolate parallel tasks from each other.
set -euo pipefail
ID="$1"; EXTRA="${2:-}"
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel)"
WT_BASE="${WT_BASE:-/c/Users/admin/itstudio-wt}"
WT="$WT_BASE/$ID"
LOG_DIR="${TEMP:-/tmp}/itstudio-codex"; mkdir -p "$LOG_DIR" "$WT_BASE"
export PATH="$USERPROFILE/.cargo/bin:$PATH"

[ -f "$ROOT/docs/tasks/$ID.md" ] || { echo "missing docs/tasks/$ID.md" >&2; exit 2; }
git -C "$ROOT" diff --quiet HEAD -- "docs/tasks/$ID.md" || { echo "commit docs/tasks/$ID.md before running" >&2; exit 2; }
if [ ! -d "$WT" ]; then git -C "$ROOT" worktree add -q -b "task/$ID" "$WT" main; fi

PROMPT="Implement docs/tasks/$ID.md. Follow AGENTS.md strictly. Do not commit. Use 'npm --cache .npm-cache' for npm commands. Run npm install first if node_modules is missing. $EXTRA"
codex exec -s workspace-write \
  -c sandbox_workspace_write.network_access=true \
  --add-dir "$USERPROFILE/.cargo" --add-dir "$USERPROFILE/.rustup" \
  -C "$WT" -o "$LOG_DIR/$ID.last.txt" "$PROMPT" > "$LOG_DIR/$ID.log" 2>&1
echo "exit=$? worktree=$WT log=$LOG_DIR/$ID.log"
