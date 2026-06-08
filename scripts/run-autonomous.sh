#!/usr/bin/env bash
# adapt — autonomous launcher (GENERIC; works for ANY target repo).
#
# Starts the DeepSeek request-normalizing proxy, ensures a baseline, and runs one fully-isolated
# lane per arg, detached (nohup → survives this terminal closing). Per-lane environment bring-up
# (DB/app) is the TARGET's responsibility via its .adapt/config.json "environment" block — adapt
# keeps target-specific logic OUT of this repo. See scripts/lane-up.template.sh for a
# Supabase+pnpm example to copy into a new target.
#
# Usage:
#   bash scripts/run-autonomous.sh <targetRepo> [lane[:model] ...]
#   bash scripts/run-autonomous.sh /path/to/app                  # one lane "a"
#   bash scripts/run-autonomous.sh /path/to/app a b              # two parallel isolated lanes
#   bash scripts/run-autonomous.sh /path/to/app "a:deepseek-v4-pro[1m]"
#
# Provider env resolution (DeepSeek base-url→proxy, token, model, thinking, timeouts):
#   <targetRepo>/.adapt/deepseek.env  (per-target override)  else  scripts/deepseek.env  (shared)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPT="$(cd "$HERE/.." && pwd)"
TARGET="${1:?usage: run-autonomous.sh <targetRepo> [lane[:model] ...]}"; shift || true
TARGET="$(cd "$TARGET" && pwd)"
LANES=( "$@" ); [ ${#LANES[@]} -eq 0 ] && LANES=( a )

ENVF="$HERE/deepseek.env"; [ -f "$TARGET/.adapt/deepseek.env" ] && ENVF="$TARGET/.adapt/deepseek.env"
[ -f "$ENVF" ] || { echo "error: no deepseek.env (looked in $HERE and $TARGET/.adapt)"; exit 1; }
adapt(){ npm --prefix "$ADAPT" run --silent adapt -- "$@"; }

set -a; . "$ENVF"; set +a; unset ANTHROPIC_API_KEY

# proxy — REQUIRED: rewrites subagent thinking:disabled -> adaptive so deepseek-v4-pro never 400s
if pgrep -f "ds-proxy.mjs" >/dev/null; then echo "ds-proxy: already running"
else nohup node "$HERE/ds-proxy.mjs" 8788 > /tmp/ds-proxy.log 2>&1 & echo "ds-proxy: started on :8788"; fi

# baseline (idempotent)
adapt baseline list "$TARGET" 2>/dev/null | grep -qw v1 || adapt baseline create v1 "$TARGET"

for spec in "${LANES[@]}"; do
  id="${spec%%:*}"; model=""; [ "$spec" != "$id" ] && model="${spec#*:}"
  if adapt lane list "$TARGET" 2>/dev/null | grep -qE "^[[:space:]]*$id[[:space:]]"; then
    echo "lane $id: already exists"
  else
    echo "lane $id: creating (runs the target's environment.up — first run boots its DB/app; slow) …"
    if [ -n "$model" ]; then adapt lane create "$id" "$TARGET" --baseline v1 --model "$model"
    else adapt lane create "$id" "$TARGET" --baseline v1; fi || { echo "lane $id: create failed (see above)"; continue; }
  fi
  echo "lane $id: starting loop (detached) …"
  nohup bash -c "set -a; . '$ENVF'; set +a; unset ANTHROPIC_API_KEY; npm --prefix '$ADAPT' run --silent adapt -- lane start '$id' '$TARGET'" \
    > "/tmp/adapt-lane-$id.log" 2>&1 &
  echo "lane $id: loop pid $!  (log: /tmp/adapt-lane-$id.log)"
done

echo
echo "watch:  npm --prefix $ADAPT run adapt -- monitor $TARGET    (http://127.0.0.1:4500)"
echo "stop:   bash $HERE/stop-autonomous.sh $TARGET"
