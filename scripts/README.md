# scripts/

Operational helpers for running adapt unattended. None of them are required to use the CLI —
`adapt init`, `adapt run-scenarios`, `adapt orchestrate`, `adapt evolve` and `adapt run` all work on
their own. These exist for the "start N isolated lanes and leave them running" workflow.

Every script takes the **target product repo** as its first argument, never this repo, and every one
supports `--help`.

## The files

| File | What it is |
| --- | --- |
| `run-autonomous.sh` | The launcher. Sources the env files, starts the proxy, ensures a baseline exists, then creates one lane per argument and starts its loop under `nohup` so it survives the terminal closing. Each loop serves that lane's own console port, so `adapt monitor` streams it live. |
| `stop-autonomous.sh` | The counterpart. Stops this target's lane loops (by pidfile, falling back to a target-scoped pattern match), any adapt-namespaced per-lane Supabase stacks, and the proxy. Leaves worktrees, branches and commits intact. |
| `ds-proxy.mjs` | A loopback HTTP proxy that rewrites `thinking:{type:"disabled"}` to `{type:"adaptive"}` on agent turns, so subagent dispatches do not get an HTTP 400 from a reasoning model. Everything else is byte-for-byte passthrough. Only needed when routing Claude Code at a third-party Anthropic-compatible endpoint. |
| `deepseek.env.example` | Template for `scripts/deepseek.env` — the provider credentials and model routing that `run-autonomous.sh` exports into the agent processes. Optional. |
| `jira.env.example` | Template for `scripts/jira.env` — the Jira credentials adapt forwards to the `mcp-atlassian` MCP server. Optional. |
| `lane-up.template.sh` | An example `environment.up` implementation (Supabase + pnpm monorepo). Copy it into your target's `.adapt/`, adapt it to your stack, and reference it from the target's `config.json`. adapt never runs this copy. |

`scripts/deepseek.env` and `scripts/jira.env` are gitignored. Copy the `.example` files, fill in your
own values, and never commit the copies.

## Order of use

```sh
# once, per machine — only if you route agents at a third-party endpoint
cp scripts/deepseek.env.example scripts/deepseek.env    # then edit

# once, per machine — only if you want the agents filing Jira issues
cp scripts/jira.env.example scripts/jira.env            # then edit
# (otherwise set "mcp": { "jira": { "enabled": false } } in the target's .adapt/config.json)

# once, per target — only if lanes need their own DB/app brought up
cp scripts/lane-up.template.sh /path/to/target/.adapt/lane-up.sh   # then edit, then point
                                                                   # config.json "environment" at it

# every session
bash scripts/run-autonomous.sh /path/to/target a b      # two isolated lanes
npm run adapt -- monitor /path/to/target                # watch them at http://127.0.0.1:4500
bash scripts/stop-autonomous.sh /path/to/target         # stop the loops
```

The monitor streams a lane live while its loop is running and serving its console port, and replays
that lane's decision log otherwise — so a stopped or crashed lane still shows its history. Check
`npm run adapt -- lane list /path/to/target` for the loop status, and `$ADAPT_LOG_DIR/adapt-lane-<id>.log`
for anything a loop printed before it died.

`ds-proxy.mjs` does not need to be started by hand — `run-autonomous.sh` starts it if it is not
already running. To run it standalone: `node scripts/ds-proxy.mjs 8788`.

## Knobs

`run-autonomous.sh` reads these environment variables, all optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADAPT_PROVIDER_ENV` | `<target>/.adapt/deepseek.env`, else `scripts/deepseek.env` | Provider env file to source. |
| `ADAPT_JIRA_ENV` | `<target>/.adapt/jira.env`, else `scripts/jira.env` | Jira env file to source. |
| `ADAPT_JIRA_COMPOSE_DIR` | `<adaptRepo>/../jira-docker/deploy` | Directory holding a `docker-compose.prod.yml` to start when `JIRA_URL` does not answer. Harmless when it does not exist. |
| `ADAPT_PROXY_PORT` | `8788` | Port for `ds-proxy.mjs`. |
| `ADAPT_LOG_DIR` | `/tmp` | Where the proxy and per-lane loop logs are written. |
| `ADAPT_BASELINE` | `v1` | Baseline name to create/reuse and fork lanes from. |

`ds-proxy.mjs` accepts `[port] [upstreamHost]` on argv, or `DS_PROXY_PORT`, `DS_PROXY_UPSTREAM` and
`DS_PROXY_HOST` in the environment. It binds loopback only — it has no authentication.

## Safety

These scripts start agents that edit, run and commit code in lane worktrees with permission prompts
disabled. Point them at a repo you can afford to lose, and read the warning section of the top-level
[README](../README.md) before the first unattended run.
