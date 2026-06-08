#!/usr/bin/env bash
# adapt — stop an autonomous run for a target (GENERIC).
# Stops lane loops + agents + the proxy, and any adapt-namespaced per-lane Supabase stacks under
# the lanes root. Leaves the target's own shared services (e.g. a shared dev Supabase) untouched.
# Usage: bash scripts/stop-autonomous.sh <targetRepo>
set -uo pipefail
TARGET="${1:?usage: stop-autonomous.sh <targetRepo>}"; TARGET="$(cd "$TARGET" && pwd)"
LANES_ROOT="$(cd "$TARGET/.." 2>/dev/null && pwd)/adapt-lanes"
echo "stopping lane loops + agents …"
pkill -f "lane start" 2>/dev/null || true
pkill -f "adapt-lanes/" 2>/dev/null || true
if [ -d "$LANES_ROOT" ]; then
  for wt in "$LANES_ROOT"/*/; do
    [ -d "$wt" ] || continue
    if grep -q '^project_id = "adapt-' "$wt/supabase/config.toml" 2>/dev/null; then
      echo "  supabase stop ($wt)"; ( cd "$wt" && supabase stop ) 2>/dev/null || true
    fi
  done
fi
echo "stopping proxy …"; pkill -f "ds-proxy.mjs" 2>/dev/null || true
echo "done."
