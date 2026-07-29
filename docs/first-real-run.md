# adapt — first real run

This is the runbook for pointing adapt at a **real product with a real model** for the first time. It
takes you from a fresh clone to a continuous loop, one command at a time, with what you should see after
each one.

If you have not yet watched the loop run offline with the stub engine, do that first — it costs nothing
and proves your workspace, scenarios, and console are wired correctly before any money is spent. The
repository [README](../README.md) has that path.

---

## Read this before you start

adapt runs coding agents against your repository **with permission prompts disabled by default**
(`--dangerously-skip-permissions`, `src/engine/claudeCode.ts`). Those agents edit files, run shell
commands, and commit. `adapt evolve` and `adapt run` also commit the `.adapt/` workspace into the target
repo every cycle (`src/orchestrator/git.ts`).

`engine.skipPermissions: false` in `config.json` does stop that flag being passed, but it will not make an
unattended run safe: the agents are headless (`claude -p`) with no one to answer an approval prompt, so
they get refused instead of gated, and the cycle produces nothing useful. Isolation is the real control —
hence the first two rules below.

- **Use a throwaway clone or a dedicated branch.** Not your main working tree.
- **Use a disposable database.** The setup hook you configure will be executed before every scenario
  run. Point it at an isolated test database, never a database with data you care about.
- **This spends money continuously.** Every cycle runs several agents. `run.maxCycles` and
  `run.maxWallClockSeconds` are `null` by default, which means *no bound* — the loop runs until you stop
  it (`src/config/schema.ts`). Set both before you walk away.
- **Credentials go in environment variables, never in `config.json`.** `adapt evolve` commits `.adapt/`
  into your target repository.

---

## Prerequisites

Run each check. Anything that fails here becomes a confusing failure ten minutes later.

| Need | Check | Required when |
| --- | --- | --- |
| **Node 22 or newer** (22 recommended) + npm | `node -v` · `npm -v` | always. `package.json` declares `engines.node >= 22`, `.nvmrc` pins 22, and CI runs the gate on 22 and 24 — stay on one of those. `better-sqlite3` ships prebuilt binaries per Node ABI, so an unusual version means `npm install` compiles it from source and needs a C++ toolchain; and below Node 22 npm reports `EBADENGINE` against adapt's own `engines` field. Node 20 reached end-of-life on 2026-04-30 and is no longer supported. |
| git, with a repo that has at least one commit | `git --version` · `git -C /path/to/target log -1` | always — baselines are tags, lanes are worktrees, and commits are the only undo |
| The `claude` CLI, installed **and signed in** | `claude --version` | always, unless `engine.type` is `"stub"` |
| Chrome or Chromium | `google-chrome --version`, or check for `/Applications/Google Chrome.app` | when `mcp.chromeDevTools.enabled` (Dreamer, Generator, Triage, Implementation, Graduation) |
| Playwright MCP (downloads browsers on first use) | `npx -y @playwright/mcp@latest --help` | when `mcp.playwright.enabled` (Runner, Verification) |
| `uvx`, from [uv](https://astral.sh/uv) | `uvx --version` | **optional** — only if you opt into Jira by setting `mcp.jira.enabled: true`, since that MCP server runs as `uvx mcp-atlassian`. Not needed otherwise. |
| A working `better-sqlite3` build | `node -e "require('better-sqlite3')"` in the adapt checkout after `npm install` | always — it stores run state |
| **Your app, already running** | `curl -I <appBaseUrl>` | always. adapt never starts your app. `startCommand` in the config is reserved and is not used by any command. |

**No issue tracker is required.** Work items are JSON files under `.adapt/work-items/`, written by adapt's
built-in local tracker (`src/tracker/localTracker.ts`). Jira is an optional mirror, off by default; if you
want it, see [Step 2a](#step-2a--optional-mirror-work-items-into-jira).

adapt itself is run from its checkout. Either use `npm run adapt -- <command>` from the adapt directory,
or run `npm link` once to put `adapt` on your PATH. The examples below use the bare `adapt` form.

---

## Step 1 — scaffold the workspace

```bash
adapt init /path/to/app --app-base-url http://localhost:3000
```

**What it does:** creates `/path/to/app/.adapt/` with `config.example.json`, a `.gitignore`, the artifact
directories, and an example scenario under `scenarios/examples/`. It then **runs a live Scout agent**
that reads your repository and writes `.adapt/north-star.md` — this costs tokens and can take several
minutes on a large codebase.

**What you should see:** a column of `created` lines, the Scout notice, then a numbered "Next" list. If
the `claude` CLI is missing, the Scout is skipped and a template north star is written instead — init
still succeeds and tells you so.

**Then read `.adapt/north-star.md`.** It is the product vision every future cycle steers toward, and the
Dreamer appends to it forever. A wrong north star sends the whole organism in the wrong direction. Edit
it now.

## Step 2 — configure

```bash
cp /path/to/app/.adapt/config.example.json /path/to/app/.adapt/config.json
```

Then edit `config.json`:

- `appBaseUrl` — where your app is actually reachable.
- `hooks.setup` / `hooks.teardown` — commands that reset and seed your **isolated test database**. These
  run for every scenario (`src/orchestrator/runScenario.ts`). Also set `hooks.requireSetupHook: true`:
  without it, a scenario with no resolvable setup hook runs against whatever state the database happens
  to be in; with it, that run is recorded `blocked` instead.
- `run.maxCycles` and `run.maxWallClockSeconds` — set both to real numbers before step 7. They are
  `null` (infinite) by default.
- `limits.*` — `maxFixAttempts`, `maxVerificationAttempts`, and `maxItemsPerRun` are the enforced
  budgets. (`limits.maxCycleSeconds` is defined but not currently enforced.)
- `engine.skipPermissions` — leave it `true` for a real run. It is honoured (`false` stops
  `--dangerously-skip-permissions` being passed), but headless agents have no way to answer an approval
  prompt, so turning it off does not gate the loop, it starves it.

Leave the Jira keys alone. `mcp.jira.enabled` is `false` by default, and every work item is written to
`.adapt/work-items/*.json` regardless. Nothing in this runbook needs Jira.

> `adapt evolve` runs `git add .adapt && git commit` in the target repo every cycle
> (`src/orchestrator/git.ts`), so anything in the workspace that is not ignored by `.adapt/.gitignore`
> lands in that repo's history. Keep credentials out of `config.json` regardless.

## Step 2a — optional: mirror work items into Jira

**Skip this section unless you already run a Jira.** It changes nothing about how adapt works; the local
tracker stays canonical and Jira never becomes the source of truth.

You need a reachable **Jira Server/DC or Cloud** instance and `uvx` on your PATH — the MCP server is
launched as `uvx mcp-atlassian` (`resolveMcpConfig()`, `src/engine/claudeCode.ts`).

1. In `config.json`, set `mcp.jira.enabled: true`. It is the single gate on the MCP server and on the
   Jira instructions in the prompts (`src/engine/mcp.ts:24`).
2. Set `jira.projectKey` to the project issues should be filed into. It is the only key in the `jira`
   block, it reaches the Triage prompt (`src/orchestrator/triage.ts:63`), and leaving it empty with
   Jira on makes every command refuse to start. The URL and credentials come from the environment,
   and the issue type and transition names are fixed in the prompts rather than configurable.
3. Export the credentials **in your shell, never in `config.json`**. `jiraMcpEnv()`
   (`src/engine/claudeCode.ts`) forwards `JIRA_URL` plus either `JIRA_PERSONAL_TOKEN` (self-hosted
   Server/DC) or `JIRA_USERNAME` + `JIRA_API_TOKEN` (Cloud) — the two modes are mutually exclusive, and
   when a PAT is set the basic-auth variables are deliberately not forwarded. Optional:
   `JIRA_SSL_VERIFY`, `JIRA_PROJECTS_FILTER`, `READ_ONLY_MODE`, `ENABLED_TOOLS`, and the Confluence
   equivalents. Start from `scripts/jira.env.example`.

With this on, the Jira MCP server is exposed to exactly three roles — triage, implementation, and
verification (`src/engine/mcp.ts`) — and triaged items pick up a `jiraKey`.

## Step 3 — seed a scenario

```bash
cp /path/to/app/.adapt/scenarios/examples/example.login.md /path/to/app/.adapt/scenarios/SCN-001.md
```

Then edit it to describe something real about *your* product.

**Only `*.md` files directly in `.adapt/scenarios/` are indexed** — the scan is one level deep
(`src/scenarios/registry.ts`). Files left under `examples/` are never run. Each file's `id:` must be
unique; the id comes from the frontmatter, not the filename. A scenario is eligible to run when its
`status` is `ready`, `active`, or `regression` (`src/orchestrator/runScenario.ts`).

Write the expected outcome the way a user would judge it, not the way a developer would. Prefer gross,
unambiguous failure signals ("the page shows a 500", "the submit button does nothing") over subtle
correctness the LLM oracle cannot reliably see.

Seed one to three scenarios for a first run. Not twenty.

## Step 4 — validate

Start your app, then:

```bash
adapt run-scenarios /path/to/app
```

**What you should see:** one line per scenario, then a summary:

```
  passed       SCN-001  A user can log in

1 scenario(s) run — 1 passed.
```

**What to check:** open `.adapt/scenario-runs/<RUN-ID>.json` and confirm the record matches reality. Then
do the honest test of the oracle — **introduce a known bug, re-run, and confirm it fails.** If a broken
app still reports `passed`, nothing downstream of this is trustworthy, and you should tighten the
scenario's expected outcome before going further.

Add `--fail-on-failure` if you want a non-zero exit when anything did not pass; by default failures are
normal input to the loop and the command exits 0.

## Step 5 — triage

With at least one failing run recorded:

```bash
adapt triage-failures /path/to/app
```

**What you should see:**

```
triaged: 1 new, 0 deduped, 0 skipped
  ITEM-001  [major] Login submit does nothing on valid credentials
```

**What to check:** `.adapt/work-items/ITEM-001.json` — is the title specific, is the severity sane, does
`runIds` link back to the run? Run the same command again: the second time the failure should be
**deduped**, not duplicated, because the dedupe key is computed deterministically from the run record
(`src/tracker/dedupe.ts`). If you enabled Jira in step 2a, the item should also carry a `jiraKey`.

## Step 6 — one full pass

```bash
adapt orchestrate /path/to/app
```

This is validate → triage → repair → verify in one bounded pass. Nothing loops.

**What you should see:**

```
cycle: 1 run(s), 1 new item(s), 1 verified, 0 parked
```

**What to check, in order:**

- whether the fix branch `adapt/ITEM-001` exists at all. adapt does not create it: `repair.ts:48` only
  computes the name and puts it in the Implementation agent's prompt
  (`src/agents/prompts/implementation.ts`), which asks the agent to create the branch and commit there.
  Nothing verifies that it did. If the branch is missing, look for uncommitted changes in your working
  tree. When it is there, it is never merged automatically — reviewing and merging is your job;
- the work item's status: `done` means an **independent** Verification agent re-ran the scenario
  black-box and confirmed it, not that the implementer said so;
- `needs-attention` means an attempt budget ran out — that state is terminal and only you clear it;
- `.adapt/decision-log/<today>.ndjson` — every agent and orchestrator event, in order.

## Step 7 — the full organism

```bash
adapt evolve /path/to/app
```

Adds the demand stage in front of the cycle: the Dreamer proposes an ambition and demands, the Critic
gates them, the Generator writes new scenarios, then the cycle validates and repairs them.

**What you should see:**

```
evolve: 3 demand(s), 1 approved, 2 new scenario(s); cycle 3 run(s), 1 verified · artifacts committed
```

**What to check:** `.adapt/demands/DMD-*.json` (including the rejected ones — the Critic's reasoning is
the most interesting output in the system), the new `.adapt/scenarios/SCN-*.md`, and the newly appended
`## Ambition` section at the bottom of `.adapt/north-star.md`. `git log` in the target repo will show
the workspace commit.

## Step 8 — run continuously

Set `run.maxCycles` and `run.maxWallClockSeconds` first. Then:

```bash
adapt run /path/to/app --console 4399
```

Open <http://127.0.0.1:4399> to watch it live. The loop repeats `evolve` until a guardrail trips.

**What you should see on exit:**

```
run: 5 cycle(s), stopped by maxCycles
```

`stoppedBy` is one of `maxCycles`, `wallClock`, `errors`, `signal` (Ctrl-C), or `control`.

Guardrails are checked *between* cycles, never by hard-killing an agent mid-step. Ctrl-C asks the loop to
stop after the current cycle; a second Ctrl-C forces the exit. An in-flight agent may also receive the
terminal interrupt.

Over hours you should see `.adapt/north-star.md` grow, new scenarios appear, and — once a scenario has
passed `limits.gradPassThreshold` times consecutively — a deterministic Playwright spec appear under
`playwrightTestDir` with the scenario marked `graduated` (`src/orchestrator/graduate.ts`).

## Step 9 — parallel lanes (optional)

To run several lineages side by side from a shared fork point:

```bash
adapt baseline create v1 /path/to/app     # clean working tree required; creates a tag AND a commit
adapt lane create a /path/to/app --baseline v1
adapt lane start a /path/to/app           # streams to this lane's own console port
adapt monitor /path/to/app                # all lanes in one dashboard
```

Each lane is a git worktree under `lanes.rootDir` (default `../adapt-lanes`, resolved relative to the
target) on branch `adapt/<laneId>`, with its own workspace, database, and port block. Bringing a lane's
environment up is your target's responsibility via `environment.up` / `reset` / `down` —
`scripts/lane-up.template.sh` is a worked example. `lane reset` and `lane destroy` are irreversible and
will ask you to confirm.

---

## What success looks like

Blueprint §17 ([the design blueprint](./superpowers/specs/2026-05-25-adapt-design.md)):

> The system discovers a real user-visible breakage, files a clear work item, an agent fixes it on a
> branch, and an *independent* agent confirms the original scenario now passes — with a decision log
> clear enough to reconstruct every step.

If you get that once, end to end, on a real product, the loop works. Everything after that is endurance.

## If the oracle is unreliable

This runbook is where you find out, and finding out is the point. Blueprint §5 warns about exactly this.
Remedies, in order of effectiveness:

1. Tighten the scenario's **expected outcome** wording until it is unambiguous to a stranger.
2. Add API-level assertions to scenarios whose truth the UI cannot reveal.
3. Prefer gross-failure detection over subtle correctness.
4. Turn on `hooks.requireSetupHook` so unmanaged database state can never masquerade as a product bug.
5. Graduate the scenarios that hold up — a Playwright spec is a deterministic oracle and never drifts.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `adapt: config not found at .../.adapt/config.json` | You ran `init` but never copied the example. `init` writes `config.example.json` only. | `cp .adapt/config.example.json .adapt/config.json` |
| `no runnable scenarios in .../.adapt/scenarios` | Your scenario is under `examples/`, or its `status` is not `ready`/`active`/`regression`. | Copy the file up one level and fix the frontmatter status. |
| `no scenario with id "SCN-002"` | `--scenario` matches the frontmatter `id:`, not the filename. | Check the `id:` field, or `.adapt/scenarios/index.json`. |
| Every run comes back `blocked` | The setup hook failed, or `requireSetupHook` is on with no hook resolved. The run note says which. | Fix the hook command; verify it works standalone in the target repo. |
| Every run comes back `failed` with connection errors | The app is not running, or `appBaseUrl` is wrong. adapt never starts your app. | `curl -I <appBaseUrl>`, then start the app. |
| `spawn claude ENOENT` | The `claude` CLI is not on PATH. | Install Claude Code and sign in, or set `engine.command` to its full path, or set `engine.type: "stub"` for a dry run. |
| Triage tries to file Jira issues and fails | You set `mcp.jira.enabled: true` (it is `false` by default) but there are no credentials or no `uvx`. | Complete [step 2a](#step-2a--optional-mirror-work-items-into-jira), or set `mcp.jira.enabled: false` and let the local tracker do the work. |
| `config at ... enables Jira but leaves jira.projectKey empty` | `mcp.jira.enabled` is on with a blank `jira.projectKey`. `loadConfig` rejects it before anything runs (`src/config/load.ts`). | Set `jira.projectKey`, or set `mcp.jira.enabled: false`. |
| `error: working tree has uncommitted changes` from `baseline create` | Baselines tag a clean commit. | Commit or stash first. |
| `error: baseline "v1" not found` from `lane create` | The tag `adapt-baseline/v1` does not exist. | `adapt baseline create v1 <target>`, or `adapt baseline list <target>` to see what does. |
| A lane shows in the monitor but streams nothing | The monitor opens a live socket only to a lane whose loop is running and serving its console port; otherwise it replays that lane's decision log. | `adapt lane list <target>` to check the loop status, and restart the loop if it is stopped. |
| `adapt console` shows only a `demo` agent | That console is a single-process view and cannot attach to another process; the stub agent just proves the pipe. | Serve the console from the loop itself: `adapt run <target> --console 4399`. |
| `better-sqlite3` fails to load or build | No prebuilt binary matched your Node version. | Reinstall on a supported Node version, or install a C++ toolchain and rebuild. |
| Any error you want the stack trace for | Errors are printed as one line by design. | Re-run with `ADAPT_DEBUG=1`. |

Exit codes: `0` success · `1` a usage or operational failure · `2` the target repo is not configured
(a config problem) · `130` interrupted.
