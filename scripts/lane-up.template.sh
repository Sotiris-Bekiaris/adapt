#!/usr/bin/env bash
# adapt — per-lane environment.up TEMPLATE (Supabase + pnpm monorepo example).
#
# adapt itself stays target-agnostic: each target supplies its own bring-up via its
# .adapt/config.json "environment" block. Copy this file to <targetRepo>/.adapt/lane-up.sh,
# adapt it to your stack, and set:
#   "environment": { "up": "bash <abs>/lane-up.sh", "down": "...lane-down.sh",
#                    "reset": "...lane-reset.sh", "portBase": 55000, "portStride": 100 }
#
# adapt runs it with cwd = the lane worktree and these injected:
#   ADAPT_LANE_ID, ADAPT_COMPOSE_PROJECT, ADAPT_PORT_BASE
# Goal: give each lane its OWN database + ports + app so lanes have independent data.
# Must be idempotent (adapt invokes it at both `lane create` and `lane start`).
set -uo pipefail
WT="$(pwd)"; LANE="${ADAPT_LANE_ID:-lane}"; PROJ="${ADAPT_COMPOSE_PROJECT:-adapt-$LANE}"
B="${ADAPT_PORT_BASE:?ADAPT_PORT_BASE not set}"
log(){ echo "[lane-up:$LANE] $*"; }

# --- derive a non-overlapping port block within [B, B+99] for THIS lane ---
WEB=$((B+0)); API=$((B+1))
SB_API=$((B+21)); SB_DB=$((B+22)); SB_SHADOW=$((B+20)); SB_POOLER=$((B+29))
SB_STUDIO=$((B+23)); SB_INBUCKET=$((B+24)); SB_ANALYTICS=$((B+27))

# --- 1) namespace this worktree's Supabase project + ports ---
CFG="$WT/supabase/config.toml"
sed -i '' -E "s/^project_id = .*/project_id = \"$PROJ\"/"         "$CFG"
sed -i '' -E "s/^port = 54321\$/port = $SB_API/"                  "$CFG"
sed -i '' -E "s/^port = 54322\$/port = $SB_DB/"                   "$CFG"
sed -i '' -E "s/^shadow_port = 54320\$/shadow_port = $SB_SHADOW/" "$CFG"
sed -i '' -E "s/^port = 54329\$/port = $SB_POOLER/"               "$CFG"
sed -i '' -E "s/^port = 54323\$/port = $SB_STUDIO/"               "$CFG"
sed -i '' -E "s/^port = 54324\$/port = $SB_INBUCKET/"             "$CFG"
sed -i '' -E "s/^port = 54327\$/port = $SB_ANALYTICS/"            "$CFG"
sed -i '' -E "s#^site_url = .*#site_url = \"http://127.0.0.1:$WEB\"#" "$CFG"

# SAFETY: never run Supabase ops unless config is the lane's own adapt-* project (guards against a
# reverted/baseline config that still points at the shared instance — e.g. after `git reset --hard`).
grep -q "^project_id = \"adapt-" "$CFG" || { log "ABORT: config not namespaced — refusing supabase start"; exit 1; }

# --- 2) start the lane's isolated Supabase ---
( cd "$WT" && supabase start ) || { log "supabase start FAILED"; exit 1; }

# --- 3) read creds + 4) write the lane's env files (CUSTOMIZE the var names for your app) ---
ST="$(cd "$WT" && supabase status -o env)"
val(){ printf '%s\n' "$ST" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p"; }
SB_URL="$(val API_URL)"; ANON="$(val ANON_KEY)"; SVC="$(val SERVICE_ROLE_KEY)"; JWT="$(val JWT_SECRET)"; DBURL="$(val DB_URL)"
cat > "$WT/apps/web/.env.local" <<EOF
VITE_API_URL=http://localhost:$API/api/v1
VITE_SUPABASE_URL=$SB_URL
VITE_SUPABASE_ANON_KEY=$ANON
EOF
cat > "$WT/apps/api/.env" <<EOF
NODE_ENV=development
API_PORT=$API
API_PREFIX=/api/v1
FRONTEND_URL=http://localhost:$WEB
SUPABASE_URL=$SB_URL
SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SVC
SUPABASE_JWT_SECRET=$JWT
DATABASE_URL=$DBURL
THROTTLE_TTL=60000
THROTTLE_LIMIT=100
EOF

# --- 5) deps + libs + schema into the lane DB ---
( cd "$WT" && pnpm install --prefer-offline --silent ) || { log "pnpm install failed"; exit 1; }
( cd "$WT" && pnpm --filter @yourscope/shared --filter @yourscope/validation --filter @yourscope/database build ) >/dev/null 2>&1 || { log "lib build failed"; exit 1; }
# NOTE: run prisma directly in the db package — turbo strips DATABASE_URL from task env.
( cd "$WT/packages/database" && DATABASE_URL="$DBURL" pnpm db:push ) || log "WARN: db:push failed"

# --- 5b) base seed: restore login accounts + demo data into a FRESH lane DB (RECOMMENDED) ---
# Scenarios that assume pre-existing data (a known login, existing records) need a baseline; the
# black-box runner cannot create it. Per-scenario hooks.setup ADD on top of this base. Snapshot a
# known-good DB once, then restore it here, guarded on emptiness so re-runs never clobber live data:
#   docker exec <db-container> pg_dump -U postgres -d postgres --data-only -t auth.users -t auth.identities  >  part1
#   docker exec <db-container> pg_dump -U postgres -d postgres --data-only --schema=public --exclude-table=public._prisma_migrations  >  part2
#   { echo 'SET session_replication_role=replica; BEGIN;'; cat part1 part2; echo 'COMMIT;'; } > "$TARGET/.adapt/base-seed.sql"
# SEED="<abs path>/.adapt/base-seed.sql"; DBC="supabase_db_$PROJ"
# if [ -f "$SEED" ] && [ "$(docker exec "$DBC" psql -U postgres -d postgres -tAc 'SELECT count(*) FROM <a-core-table>' 2>/dev/null | tr -d '[:space:]')" = "0" ]; then
#   docker exec -i "$DBC" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$SEED" && log "base seed loaded"
# fi

# --- 6) pin web dev port + 7) point adapt config at this lane's app ---
sed -i '' -E "s#\"dev\": \"vite --port [0-9]+\"#\"dev\": \"vite --port $WEB\"#" "$WT/apps/web/package.json"
sed -i '' -E "s#\"appBaseUrl\": \"[^\"]*\"#\"appBaseUrl\": \"http://localhost:$WEB\"#" "$WT/.adapt/config.json"

# --- 8) start the app if down + 9) wait for readiness ---
if ! curl -s -o /dev/null "http://localhost:$WEB/" 2>/dev/null; then
  ( cd "$WT" && nohup pnpm dev > "$WT/.adapt/lane-dev.log" 2>&1 & )
fi
for i in $(seq 1 120); do
  w=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WEB/" 2>/dev/null); w=${w:-000}
  a=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$API/api/v1/health" 2>/dev/null); a=${a:-000}
  [ "$w" = 200 ] && [ "$a" = 200 ] && { log "ready (web=$w api=$a)"; exit 0; }
  sleep 2
done
log "app not ready (web=$w api=$a) — see $WT/.adapt/lane-dev.log"; exit 1
