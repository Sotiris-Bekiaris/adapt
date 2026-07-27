#!/usr/bin/env bash
# adapt — autonomous launcher (GENERIC; works for ANY target repo).
#
# WHAT IT DOES
#   1. Sources the provider env file (optional) and the Jira env file (optional).
#   2. Best-effort checks that the configured Jira answers, and brings up a compose stack if you
#      have pointed one out via ADAPT_JIRA_COMPOSE_DIR.
#   3. Starts the request-normalizing proxy (scripts/ds-proxy.mjs) if one is not already running.
#   4. Ensures a named baseline exists in the target repo.
#   5. Creates one isolated lane per argument and starts its loop detached (nohup — survives this
#      terminal closing), logging to $ADAPT_LOG_DIR.
#
#   Per-lane environment bring-up (DB/app) is the TARGET's responsibility via its
#   .adapt/config.json "environment" block — adapt keeps target-specific logic OUT of this repo.
#   See scripts/lane-up.template.sh for a Supabase+pnpm example to copy into a new target.
#
# WHEN TO RUN IT
#   After `adapt init <targetRepo>`, once the target has a config.json, at least one scenario, and
#   a committed clean working tree. This starts unattended agents that edit and commit code in
#   lane worktrees. Read the warning section of the README first.
#
# USAGE
#   bash scripts/run-autonomous.sh <targetRepo> [lane[:model] ...]
#   bash scripts/run-autonomous.sh /path/to/app                     # one lane "a"
#   bash scripts/run-autonomous.sh /path/to/app a b                 # two parallel isolated lanes
#   bash scripts/run-autonomous.sh /path/to/app "a:deepseek-v4-pro" # pin a model for lane "a"
#   bash scripts/run-autonomous.sh --help
#
# ENVIRONMENT (all optional, shown with their defaults)
#   ADAPT_PROVIDER_ENV       <targetRepo>/.adapt/deepseek.env, else scripts/deepseek.env
#   ADAPT_JIRA_ENV           <targetRepo>/.adapt/jira.env,     else scripts/jira.env
#   ADAPT_JIRA_COMPOSE_DIR   <adaptRepo>/../jira-docker/deploy — a directory holding a
#                            docker-compose.prod.yml to start when JIRA_URL does not answer.
#                            Leave it unset and pointing at nothing to skip that entirely.
#   ADAPT_PROXY_PORT         8788
#   ADAPT_LOG_DIR            /tmp
#   ADAPT_BASELINE           v1
#
#   Copy scripts/deepseek.env.example and scripts/jira.env.example to create the env files.
#   Both are optional: with neither present, agents run on whatever credentials the `claude` CLI
#   is already logged in with, and no Jira credentials are forwarded.

set -euo pipefail

# Print the header comment block above as help text.
usage() { sed -e '1d' -e '/^[^#]/,$d' "${BASH_SOURCE[0]}" | sed -e 's/^#//' -e 's/^ //'; }
case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
  "") usage; echo; echo "error: missing <targetRepo>" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPT="$(cd "$HERE/.." && pwd)"

# --- required binaries -------------------------------------------------------
need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: \`$1\` is not on PATH — $2" >&2
    exit 1
  }
}
need node   "install Node 18+ (https://nodejs.org)"
need npm    "it ships with Node"
need git    "lanes are git worktrees"
need curl   "used to probe the Jira URL and the target app"
need pgrep  "used to detect an already-running proxy"

TARGET_ARG="$1"; shift
TARGET="$(cd "$TARGET_ARG" 2>/dev/null && pwd)" || {
  echo "error: no such directory: $TARGET_ARG" >&2; exit 1; }
[ -f "$TARGET/.adapt/config.json" ] || {
  echo "error: $TARGET/.adapt/config.json not found." >&2
  echo "       Run \`npm --prefix $ADAPT run adapt -- init $TARGET\`, then copy" >&2
  echo "       .adapt/config.example.json to .adapt/config.json and edit it." >&2
  exit 1; }

LANES=( "$@" )
if [ ${#LANES[@]} -eq 0 ]; then LANES=( a ); fi

PROXY_PORT="${ADAPT_PROXY_PORT:-8788}"
LOG_DIR="${ADAPT_LOG_DIR:-/tmp}"
BASELINE="${ADAPT_BASELINE:-v1}"
mkdir -p "$LOG_DIR"

# --- provider + Jira env (both optional) -------------------------------------
# Resolution order: explicit override, then per-target file, then the shared file in scripts/.
resolve_env() {  # resolve_env <overrideValue> <basename>
  local override="$1" name="$2"
  if [ -n "$override" ]; then
    [ -f "$override" ] || { echo "error: $override not found" >&2; exit 1; }
    printf '%s\n' "$override"; return
  fi
  if [ -f "$TARGET/.adapt/$name" ]; then printf '%s\n' "$TARGET/.adapt/$name"
  elif [ -f "$HERE/$name" ];        then printf '%s\n' "$HERE/$name"
  else printf '%s\n' ""; fi
}
ENVF="$(resolve_env "${ADAPT_PROVIDER_ENV:-}" deepseek.env)"
JIRAF="$(resolve_env "${ADAPT_JIRA_ENV:-}" jira.env)"

set -a
if [ -n "$ENVF" ]; then
  # shellcheck disable=SC1090
  . "$ENVF"
  echo "provider: $ENVF"
else
  echo "provider: no deepseek.env found (looked in $TARGET/.adapt and $HERE)"
  echo "          agents will use whatever credentials \`claude\` is already logged in with."
  echo "          To route them elsewhere: cp $HERE/deepseek.env.example $HERE/deepseek.env"
fi
if [ -n "$JIRAF" ]; then
  # shellcheck disable=SC1090
  . "$JIRAF"
  echo "jira env: $JIRAF"
else
  echo "jira env: none (agents run without Jira credentials — set mcp.jira.enabled:false in"
  echo "          .adapt/config.json to turn the tracker off entirely)"
fi
set +a

# Only clear an ambient Anthropic key when this run supplies its own token; otherwise unsetting it
# would break a plain Anthropic-API-key setup.
if [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]; then unset ANTHROPIC_API_KEY; fi

adapt() { npm --prefix "$ADAPT" run --silent adapt -- "$@"; }

# --- Jira server (best-effort, never fatal) ----------------------------------
# adapt defaults jira ON. If a JIRA_URL is configured, make sure it answers; optionally bring up a
# compose stack you have pointed at. A dead Jira just means the jira MCP reports no connection —
# the agents still run.
if [ -n "${JIRA_URL:-}" ]; then
  if curl -fsS -o /dev/null --max-time 3 "$JIRA_URL"; then
    echo "jira: up at $JIRA_URL"
  else
    JDOCK_DEFAULT="$ADAPT/../jira-docker/deploy"
    JDOCK_RAW="${ADAPT_JIRA_COMPOSE_DIR:-$JDOCK_DEFAULT}"
    JDOCK="$(cd "$JDOCK_RAW" 2>/dev/null && pwd || true)"
    if [ -n "$JDOCK" ] && [ -f "$JDOCK/docker-compose.prod.yml" ] && command -v docker >/dev/null 2>&1; then
      echo "jira: not responding — starting compose stack in $JDOCK (first boot is slow) …"
      ( cd "$JDOCK" && docker compose -f docker-compose.prod.yml up -d ) \
        || echo "jira: compose up failed (continuing without Jira)"
    else
      echo "jira: $JIRA_URL not responding — agents run without Jira."
      echo "      Start your Jira instance yourself, or set ADAPT_JIRA_COMPOSE_DIR to a directory"
      echo "      containing a docker-compose.prod.yml for it."
    fi
  fi
fi

# --- request-normalizing proxy -----------------------------------------------
# Rewrites subagent thinking:disabled -> adaptive so reasoning models never 400. Harmless when the
# provider env file is absent and nothing points at it. See scripts/ds-proxy.mjs.
if pgrep -f "ds-proxy\.mjs" >/dev/null 2>&1; then
  echo "ds-proxy: already running"
else
  nohup node "$HERE/ds-proxy.mjs" "$PROXY_PORT" > "$LOG_DIR/ds-proxy.log" 2>&1 &
  echo "ds-proxy: started on :$PROXY_PORT  (log: $LOG_DIR/ds-proxy.log)"
fi

# --- baseline (idempotent) ---------------------------------------------------
if adapt baseline list "$TARGET" 2>/dev/null | grep -qw "$BASELINE"; then
  echo "baseline: \"$BASELINE\" already exists"
else
  adapt baseline create "$BASELINE" "$TARGET" || {
    echo "error: could not create baseline \"$BASELINE\" in $TARGET." >&2
    echo "       \`baseline create\` needs a git repo with at least one commit and a clean" >&2
    echo "       working tree. Commit or stash your changes and re-run." >&2
    exit 1; }
fi

# --- lanes -------------------------------------------------------------------
for spec in "${LANES[@]}"; do
  id="${spec%%:*}"
  model=""
  if [ "$spec" != "$id" ]; then model="${spec#*:}"; fi

  if adapt lane list "$TARGET" 2>/dev/null | grep -qE "^[[:space:]]*$id[[:space:]]"; then
    echo "lane $id: already exists"
  else
    echo "lane $id: creating (runs the target's environment.up — first run boots its DB/app; slow) …"
    if [ -n "$model" ]; then
      adapt lane create "$id" "$TARGET" --baseline "$BASELINE" --model "$model" \
        || { echo "lane $id: create failed (see above)"; continue; }
    else
      adapt lane create "$id" "$TARGET" --baseline "$BASELINE" \
        || { echo "lane $id: create failed (see above)"; continue; }
    fi
  fi

  echo "lane $id: starting loop (detached) …"
  nohup bash -c '
    set -euo pipefail
    if [ -n "${1:-}" ]; then set -a; . "$1"; set +a; fi
    if [ -n "${2:-}" ]; then set -a; . "$2"; set +a; fi
    if [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]; then unset ANTHROPIC_API_KEY; fi
    npm --prefix "$3" run --silent adapt -- lane start "$4" "$5"
  ' _ "$ENVF" "$JIRAF" "$ADAPT" "$id" "$TARGET" > "$LOG_DIR/adapt-lane-$id.log" 2>&1 &
  echo "lane $id: loop pid $!  (log: $LOG_DIR/adapt-lane-$id.log)"
done

echo
echo "watch:  npm --prefix $ADAPT run adapt -- monitor $TARGET    (http://127.0.0.1:4500)"
echo "stop:   bash $HERE/stop-autonomous.sh $TARGET"
