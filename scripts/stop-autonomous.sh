#!/usr/bin/env bash
# adapt — stop an autonomous run for one target (GENERIC).
#
# WHAT IT DOES
#   1. Kills each lane loop for THIS target, by the pid in <laneWorktree>/.adapt/loop.pid, falling
#      back to a pattern match scoped to this target's lanes root.
#   2. Stops any adapt-namespaced per-lane Supabase stack under that lanes root (only projects
#      whose config.toml project_id starts with "adapt-", so a shared dev stack is never touched).
#   3. Stops the request-normalizing proxy started by run-autonomous.sh, unless --keep-proxy.
#
#   The lanes root is read from <targetRepo>/.adapt/config.json ("lanes": { "rootDir": … }),
#   resolved relative to the target repo, so a non-default rootDir is handled correctly.
#
# WHEN TO RUN IT
#   Any time you want the agents to stop. Lane worktrees, branches and commits are left intact —
#   this only stops processes. Use `adapt lane reset` / `adapt lane destroy` to undo work.
#
# USAGE
#   bash scripts/stop-autonomous.sh <targetRepo> [--keep-proxy] [--dry-run]
#   bash scripts/stop-autonomous.sh --help

set -euo pipefail

usage() { sed -e '1d' -e '/^[^#]/,$d' "${BASH_SOURCE[0]}" | sed -e 's/^#//' -e 's/^ //'; }
case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
  "") usage; echo; echo "error: missing <targetRepo>" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_ARG="$1"; shift
TARGET="$(cd "$TARGET_ARG" 2>/dev/null && pwd)" || {
  echo "error: no such directory: $TARGET_ARG" >&2; exit 1; }

KEEP_PROXY=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --keep-proxy) KEEP_PROXY=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    *) echo "error: unknown option: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "error: \`node\` is not on PATH" >&2; exit 1; }

# Resolve the lanes root the same way adapt does: config.lanes.rootDir relative to the target repo.
LANES_ROOT="$(node -e '
  const { readFileSync } = require("node:fs");
  const { resolve, join } = require("node:path");
  const target = process.argv[1];
  let rootDir = "../adapt-lanes";
  try {
    const cfg = JSON.parse(readFileSync(join(target, ".adapt", "config.json"), "utf8"));
    if (cfg?.lanes?.rootDir) rootDir = cfg.lanes.rootDir;
  } catch { /* no config — fall back to the schema default */ }
  process.stdout.write(resolve(target, rootDir));
' "$TARGET")"
echo "target:     $TARGET"
echo "lanes root: $LANES_ROOT"

kill_pid() {  # kill_pid <pid> <label>
  local pid="$1" label="$2"
  kill -0 "$pid" 2>/dev/null || return 0
  if [ "$DRY_RUN" = 1 ]; then echo "  would kill $pid  ($label)"; return 0; fi
  echo "  kill $pid  ($label)"
  kill "$pid" 2>/dev/null || true
}

# --- 1) lane loops -----------------------------------------------------------
echo "stopping lane loops + agents …"
killed_any=0
if [ -d "$LANES_ROOT" ]; then
  for wt in "$LANES_ROOT"/*/; do
    [ -d "$wt" ] || continue
    pidfile="$wt.adapt/loop.pid"
    if [ -f "$pidfile" ]; then
      pid="$(tr -d '[:space:]' < "$pidfile")"
      if [ -n "$pid" ]; then kill_pid "$pid" "loop pidfile $pidfile"; killed_any=1; fi
    fi
  done
fi

# Fallback / sweep: only processes whose command line mentions THIS target or THIS lanes root.
# `pgrep -f` matches whole command lines, so the pattern must be target-scoped or it would reach
# another target's run, or another user's.
sweep() {  # sweep <pattern>
  local pids
  pids="$(pgrep -f "$1" 2>/dev/null || true)"
  for pid in $pids; do
    if [ "$pid" = "$$" ]; then continue; fi
    kill_pid "$pid" "matched: $1"
    killed_any=1
  done
}
sweep "lane start .*$TARGET"
sweep "$LANES_ROOT/"
[ "$killed_any" = 1 ] || echo "  (no lane loops were running)"

# --- 2) per-lane Supabase stacks --------------------------------------------
if [ -d "$LANES_ROOT" ] && command -v supabase >/dev/null 2>&1; then
  for wt in "$LANES_ROOT"/*/; do
    [ -d "$wt" ] || continue
    if grep -q '^project_id = "adapt-' "$wt/supabase/config.toml" 2>/dev/null; then
      if [ "$DRY_RUN" = 1 ]; then echo "  would supabase stop ($wt)"; continue; fi
      echo "  supabase stop ($wt)"
      ( cd "$wt" && supabase stop ) >/dev/null 2>&1 || true
    fi
  done
fi

# --- 3) proxy ----------------------------------------------------------------
if [ "$KEEP_PROXY" = 1 ]; then
  echo "keeping proxy running (--keep-proxy)"
else
  echo "stopping proxy …"
  # Scoped to this checkout's copy of the script, so a proxy started from another clone survives.
  sweep "$HERE/ds-proxy.mjs"
fi

echo "done."
