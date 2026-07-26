# adapt

**A**gent **D**evelopment for **A**utonomous **P**roduc**T**s.

> A fully autonomous, closed-loop multi-agent system that evolves a software product with **no human in the loop**. A team of cooperating coding agents continuously *dreams up* what the product should become, expresses each ambition as user-level **scenarios**, validates those scenarios against the running product like a real user, converts real failures into tracked work, implements the changes, and **independently re-verifies** the original scenario before it counts as done.

There is no "done." There is no success state. **Success *is* the continued, perpetual evolution of the product** — an organism adapting to environmental pressure. The human is the **observer/experimenter outside the loop**, never an approver inside it.

The methodology has a name: **Scenario-Driven Agentic Development (SDAD)**.

> 📖 **Prefer to *watch* how it works?** Open [`story.html`](./story.html) for an interactive, scroll-driven walkthrough of the whole loop.

> **Status:** a personal research experiment. The build sequence is *Phase A — "spine first"*: build and trust the autonomous validation-and-repair spine before adding the demand engine.

---

## ⚠️ Read before you run this

adapt is an **experimental** system that lets AI agents modify a codebase **without asking you first**. Understand these before pointing it at anything:

- **Agents run with permission prompts disabled.** `engine.skipPermissions` defaults to `true`, which passes `--dangerously-skip-permissions` to Claude Code. Agents execute shell commands, edit files, and make git commits **with no approval step**. Set it to `false` to opt out.
- **Point it at a throwaway repo or a dedicated branch — never at code you cannot afford to lose.** Lanes are git worktrees that adapt will `git reset --hard` back to a baseline. Uncommitted work in a lane worktree is destroyed.
- **Use an isolated, disposable database.** Setup/teardown hooks reset the target's data between runs. Never aim it at a database with real or production data.
- **It costs money and runs unattended.** Autonomous loops driving real browsers and LLM calls can run for hours. Set `run.maxCycles` and `run.maxWallClockSeconds` before starting a long run.
- **Never expose the monitor beyond localhost.** It binds to `127.0.0.1` and has no authentication; it can start and stop agent loops.
- **Provide credentials via gitignored env files only** (`scripts/deepseek.env`, `scripts/jira.env`, the target's `.adapt/config.json`). No secrets belong in this repo.

Provided **as-is, without warranty** — see [LICENSE](./LICENSE). You are responsible for what the agents do on your machine.

---

## Table of Contents

- [⚠️ Read before you run this](#️-read-before-you-run-this)
- [What adapt is](#what-adapt-is)
- [What "self-improving" means (and does not)](#what-self-improving-means-and-does-not)
- [Core principles — the constitution](#core-principles--the-constitution)
- [The agents](#the-agents)
- [Separation of powers — permissions](#separation-of-powers--permissions)
- [The loop](#the-loop)
- [The two-repo model](#the-two-repo-model)
- [The `.adapt/` workspace](#the-adapt-workspace)
- [Scenarios: the contract](#scenarios-the-contract)
- [Baselines & lanes](#baselines--lanes)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [CLI reference](#cli-reference)
- [Configuration reference](#configuration-reference)
- [Safeguards — the hard rules](#safeguards--the-hard-rules)
- [Status & honest limitations](#status--honest-limitations)
- [License](#license)

---

## What adapt is

adapt is a **generic, plug-and-play framework**. No target-product logic lives in this repo. You point it at *any* full-stack product via config, and it becomes target-specific only at runtime — by reading the plugged project's source, UI, and configuration.

A team of cooperating coding agents runs a perpetual evolutionary loop against that product:

1. **Dream** the next ambition for the product.
2. **Critique** it — does it carry real value, or is it bloat?
3. **Generate** user-level scenarios that express the ambition.
4. **Validate** those scenarios against the *running* product, like a real user in a real browser.
5. **Triage** real failures into deduplicated, classified work items.
6. **Repair** the product with the smallest safe change.
7. **Verify** — independently rerun the original scenario before anything counts as done.

Then it goes around again. Forever. There is no terminal state — the loop is the point.

The whole system behaves like **an organism adapting to environmental pressure**: the north-star is its genome, scenarios are the selection pressure, reality is the fitness function, and git is the fossil record.

## What "self-improving" means (and does not)

**It means:** the *product repository* improves over time, autonomously — features get added, bugs get fixed, the north-star is raised, scenario coverage grows.

**It does NOT mean** the agents rewrite their own prompts or behavior. **The agents are static.** Only the product evolves: its code, its scenarios, its tests, its north-star. The machinery that drives evolution does not evolve.

## Core principles — the constitution

1. **The scenario is the contract.** A scenario is a real user goal plus the visible outcome that proves it — not the code, not the issue, not the UI's current behavior.
2. **Reality is the judge.** A change is "done" only when an *independent* agent confirms the scenario passes against the *running* product in a real browser.
3. **Durable artifacts over agent memory.** Agents communicate through versioned files and tracked work items, never conversational memory.
4. **No human in the loop; human as observer.** Judgment is replaced by *structural* safeguards: independent verification, adversarial critique, attempt limits.
5. **Git is the safety net.** Every agent change is a commit on a branch in the target repo; the whole evolutionary history is replayable and revertible.
6. **Separation of powers by permission.** Different agents get deliberately different knowledge and tools so the loop cannot self-approve its own mistakes.
7. **Observability is a first-class subsystem**, not a log file.
8. **Demand must have a source.** Autonomy without pressure is drift; the Dreamer + Critic pair is the engine that creates pressure.

## The agents

All roles are instances of a coding-agent engine (default: **Claude Code, headless**) launched by the orchestrator with a specific prompt, working directory, and MCP server set.

1. **Dreamer** — reads the north-star and current product state and proposes the next ambition (features, raised goals, improvements). Highest drift risk; constrained by the Critic and reality-grounded verification.
2. **Critic** — a skeptical product owner. Challenges each candidate demand (real value vs. bloat, busywork, reward-hacking). Only survivors enter the backlog.
3. **Scenario Generator** — source-aware. Turns approved demands plus the existing product into user-centered, black-box scenarios with stable IDs, personas, preconditions, steps, expected outcomes, failure signals, tags, and priority. Uses code only for discovery.
4. **Scenario Runner** — black-box, **no source access**. Executes scenarios against the running app via Playwright MCP, like a user. Classifies each run as `passed | failed | blocked | flaky | invalid | inconclusive`. Captures evidence (screenshots, DOM/a11y snapshot, console errors, network errors, URL, failing step). Does not create work items.
5. **Failure Triage** — reads `failed | blocked | flaky | invalid | inconclusive` runs; deduplicates (one root cause breaking 20 scenarios → *one* work item, not 20); classifies bug vs. environment vs. test-data vs. invalid-scenario vs. flaky; creates/updates work items with full evidence.
6. **Implementation Agent** — source-aware. Reads work item + scenario + evidence, makes the smallest safe change, adds/updates tests where practical, runs checks, optionally self-checks via Chrome DevTools MCP, and moves the item to *In Review* / *Ready for Verification*. **Must not** mark Done, weaken a scenario, or delete failing scenarios.
7. **Verification Agent** — independent from the Implementation Agent; black-box, preferably no source access. Reruns the *exact* original scenario (plus nearby regression scenarios) against the fixed app. Outcomes: `verified → Done` | `still failing → reopen` | `partially fixed → comment` | `flaky → require repeat` | `obsolete → needs-product-review`.

**Orchestrator** — **not an LLM**. A deterministic state-machine service. It owns: which scenarios are runnable, which agent runs next, which commit is under test, the scenario↔work-item mapping, retries and attempt limits, duplicate-failure handling, cycle scheduling, and emitting events to observability.

## Separation of powers — permissions

Permissions are deliberately uneven so the loop *cannot* self-approve its own mistakes.

| Agent | Source Code | Browser | Work Tracker | Write Code | Close Work Item |
|---|---|---|---|---|---|
| **Dreamer** | read | read (explore) | read | no | no |
| **Critic** | read | no | read | no | no |
| **Scenario Generator** | read (discovery) | Playwright (explore) | read | no | no |
| **Scenario Runner** | **no** | Playwright | no | no | no |
| **Failure Triage** | read-only | evidence only | create / update | no | no |
| **Implementation** | yes | Chrome DevTools | update only | yes | **no** |
| **Verification** | preferably no | Playwright | update status | no | **yes — only after verification** |
| **Orchestrator** | metadata only | no | limited | no | no |

## The loop

A full evolutionary pass runs these stages, in order — then loops back around, with no terminal state:

```
        ┌──────────────────────────────────────────────────────────────┐
        │                                                              │
        ▼                                                              │
   ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐           │
   │  DREAM  │──▶│ CRITIQUE │──▶│ GENERATE │──▶│ VALIDATE │──┐        │
   └─────────┘   └──────────┘   └──────────┘   └──────────┘  │        │
     Dreamer       Critic       Generator        Runner       │        │
                                                              ▼        │
   ┌──────────┐   ┌──────────┐   ┌──────────┐                         │
   │  VERIFY  │◀──│  REPAIR  │◀──│  TRIAGE  │                         │
   └──────────┘   └──────────┘   └──────────┘                         │
   Verification  Implementation    Triage                             │
        │                                                              │
        └──────────────────────────────────────────────────────────────┘
                    (no success state — evolution continues)
```

The **spine** (Phase A — built and trusted first) is the inner subset:

```
   VALIDATE ──▶ TRIAGE ──▶ REPAIR ──▶ VERIFY
```

The demand engine (`DREAM → CRITIQUE → GENERATE`) is layered on once the spine is trustworthy.

## The two-repo model

adapt is two repositories that never blur together:

- **`adapt/`** — the generic framework (*this* repo). Static, no target logic: orchestrator, console, agent-prompts, schemas, CLI.
- **`<target-project>/`** — *any* full-stack product you point adapt at. The agents read its source and **commit changes there** (this is the git safety net). A per-target `.adapt/` workspace is created on plug-in.

The framework only ever learns *what your product is* at runtime, by reading the target's source, UI, and config.

## The `.adapt/` workspace

`adapt init` scaffolds this workspace inside the target repo; the loop fills the rest in:

```
<target-project>/
  .adapt/
    config.json            # target-specific (gitignored if it carries secrets); copy from config.example.json
    config.example.json    # committed template (scaffolded by `adapt init`)
    north-star.md          # versioned vision doc (the "genome") — COMMITTED; watch ambition evolve
    scenarios/             # user-centered scenarios (intent) — COMMITTED
      examples/example.login.md
    scenarios/index.json   # machine-readable registry (IDs, status, priority, tags, links, lastResult)
    scenario-runs/         # append-only run ledger (generated; gitignored)
      <RUN-ID>.json
    work-items/            # local issue payloads (canonical; Jira optional via adapter)
      <ITEM-ID>.json
    verification-reports/
      <REPORT-ID>.json
    decision-log/          # narrated timeline — the experiment's primary deliverable
    .gitignore             # ignores state.db*, lane.json, loop.pid, scenario-runs/
```

**ID discipline everywhere:** `SCN-###`, `RUN-<ts>`, `ITEM-###`, `REPORT-###`, commit SHA, branch. Every artifact is traceable to the scenario it serves and the commit that changed it.

## Scenarios: the contract

A scenario is a markdown file with **YAML frontmatter** (machine metadata, including optional `hooks.setup` / `hooks.teardown`) and a **body** (persona, preconditions, user-level steps, expected outcome, failure signals).

Run results are **append-only** — recorded in `scenario-runs/`, never written back into the scenario file. Never mutate a scenario to store history; intent and results stay separate.

## Baselines & lanes

You can race multiple evolutionary strategies from the same starting point and compare them.

- A **baseline** is a shared, *named fork point* of the target (e.g. `v1`) — tag the current target state, then fork from it.
- A **lane** is an isolated lineage forked from a baseline: its own git worktree, branch, ports, and *optionally its own model*. Lanes evolve in **parallel**, independently — so you can let, say, one lane driven by one model and another by a different model evolve from identical genomes and see which organism thrives.

Watch all lanes at once with [`monitor`](#cli-reference).

## Tech stack

- **adapt itself:** Node + TypeScript, run via `tsx`. Deps include `commander`, `zod`, `better-sqlite3`, `ws`, `gray-matter`.
- **Black-box surface** (Runner, Verifier): **Playwright MCP** (`@playwright/mcp`) — navigates via the accessibility tree.
- **White-box debugging** (Triage, Implementation): **Chrome DevTools MCP** (`chrome-devtools-mcp`).
- **Agent engine:** **Claude Code, headless** (default; streaming structured output feeds the live console). Configurable to a `stub` engine for dry runs.
- **Work tracker:** **Jira** behind a swappable adapter; local `.adapt/work-items/*.json` is the canonical payload and offline fallback. Jira is **disabled by default**.

## Getting started

### Prerequisites

- **Node 18+** (uses native `fetch` / ESM) and **npm**.
- A **full-stack target product** whose app can be started and reached at a base URL.

### Steps

**1. Clone & install**

```bash
git clone <repo> && cd adapt
npm install
```

**2. Plug in a target.** This scaffolds `.adapt/` inside the target and writes `config.example.json`:

```bash
npm run adapt -- init /path/to/target-repo --app-base-url http://localhost:3000
# or, if installed as a bin:
adapt init /path/to/target-repo --app-base-url http://localhost:3000
```

**3. Configure.** Inside the target's `.adapt/`, copy `config.example.json` → `config.json`, then set `targetRepoPath`, `appBaseUrl`, optional `startCommand`, DB `hooks`, and (optionally) enable `jira`.

**4. Seed a scenario.** Edit or add markdown scenarios under `.adapt/scenarios/` (an `examples/example.login.md` is provided). Set its `status: ready`.

**5. Watch it live.** Serves mission-control on port `4399` by default:

```bash
npm run adapt -- console /path/to/target-repo
```

**6. Run a bounded pass, then the full loop** — see the [CLI reference](#cli-reference).

> **Note:** every command takes the target repo path as its argument. Via npm, use `npm run adapt -- <command> <args>`; if the `adapt` bin is on your `PATH`, use `adapt <command> <args>`.

## CLI reference

These are the real commands, grouped by purpose.

### Single-step

| Command | Description |
|---|---|
| `run-scenarios <targetRepo> [--scenario SCN-001]` | Run ready scenarios against the target app (or just one by id). |
| `triage-failures <targetRepo>` | Triage failed runs into deduplicated, classified work items. |

### Bounded passes

| Command | Description |
|---|---|
| `orchestrate <targetRepo>` | One bounded autonomous pass: **validate → triage → repair → verify** (the spine). |
| `evolve <targetRepo>` | One full evolutionary pass: **dream → critique → generate → validate → triage → repair → verify**. |

### Continuous

| Command | Description |
|---|---|
| `run <targetRepo>` | Run the organism continuously (bounded `evolve` loop) until a guardrail trips or you press Ctrl-C. Ctrl-C once = graceful stop, twice = immediate. |

### Observability

| Command | Description |
|---|---|
| `console <targetRepo> [--port 4399]` | Start the live single-run mission-control console. |
| `monitor <targetRepo> [--port 4500]` | Watch ALL lanes live in one dashboard. |

### Plug-in

| Command | Description |
|---|---|
| `init <targetRepo> [--app-base-url http://localhost:3000]` | Scaffold the `.adapt` workspace inside a target repo. |

### Baselines (shared fork points)

| Command | Description |
|---|---|
| `baseline create <name> <targetRepo>` | Tag the current target state as a named baseline (e.g. `v1`). |
| `baseline list <targetRepo>` | List baselines. |

### Lanes (parallel evolutionary lineages)

| Command | Description |
|---|---|
| `lane create <laneId> <targetRepo> --baseline <name> [--model <model>]` | Fork a baseline into a new isolated lane (its own git worktree + branch, optionally driven by a specific model). |
| `lane list <targetRepo>` | List lanes. |
| `lane start <laneId> <targetRepo> [--detach]` | Start (and maintain) a lane's autonomous loop; `--detach` runs it in the background. |
| `lane stop <laneId> <targetRepo>` | Stop a lane's background loop. |
| `lane reset <laneId> <targetRepo>` | Discard a lane's work and restore it to its baseline. |
| `lane destroy <laneId> <targetRepo>` | Remove a lane (worktree + branch). |

## Configuration reference

The config is validated by a zod schema. Key fields:

**Top-level**

| Field | Notes |
|---|---|
| `targetRepoPath` | string, **required** |
| `appBaseUrl` | url, **required** |
| `playwrightTestDir` | default `"tests/adapt"` |
| `startCommand` | optional |

**`engine`** — `{ type: "claude-code" | "stub" (default "claude-code"), command?, skipPermissions (default true → passes --dangerously-skip-permissions) }`

**`console`** — `{ port (default 4399) }`

**`hooks`** — `{ setup?, teardown? }` — global DB lifecycle hooks; scenario-level hooks override these.

**`jira`** — `{ enabled (default false), baseUrl?, projectKey, defaultIssueType (default "Bug"), transitions: { inReview, readyForVerification, done, reopened } }`

**`mcp`** — `{ playwright.enabled (default true), chromeDevTools.enabled (default true), jira.enabled (default false) }`

**`limits`**

| Field | Default |
|---|---|
| `maxFixAttempts` | 2 |
| `maxVerificationAttempts` | 3 |
| `maxItemsPerRun` | 10 |
| `maxCycleSeconds` | 3600 |
| `maxDemandsPerCycle` | 3 |
| `maxScenariosPerDemand` | 2 |
| `gradPassThreshold` | 3 |

**`run`**

| Field | Default |
|---|---|
| `maxCycles` | 10 |
| `maxWallClockSeconds` | 3600 |
| `pauseSeconds` | 5 |
| `maxConsecutiveErrors` | 3 |

**`environment`** (optional; absent = lanes are git-only, with no env bring-up/reset) — `{ up?, down?, reset?, portBase (default 54300), portStride (default 100) }`

**`lanes`** — `{ rootDir (default "../adapt-lanes") }`

> **No secrets in the repo:** the real `config.json` is gitignored; only `config.example.json` is committed.

## Safeguards — the hard rules

These are non-negotiable. They are the structural substitute for human judgment.

- **Never delete a scenario because it passes** — passing scenarios become regression assets.
- **The Implementation Agent never closes a work item.**
- **The agent that implements a fix never verifies its own fix.**
- **Don't create work items for `blocked` / `invalid` / `inconclusive` runs** unless explicitly configured.
- **Deduplicate** — never spam the tracker with duplicates of one root cause.
- **No uncontrolled infinite loops by default** — explicit cycle stepping with attempt limits (`maxFixAttempts`, `maxVerificationAttempts`, `maxItemsPerRun`, `maxCycles`, wall-clock).
- **No secrets in the repo** — the real `config.json` is gitignored; only `config.example.json` is committed.
- **Never weaken expected outcomes** to make failures disappear.
- **Never modify agent prompts** as part of the product-improvement loop.

## Status & honest limitations

This is a research experiment, and its risks are real.

**The oracle problem (the core risk).** LLM black-box judgment is *reliable for gross failures* — 500s, blank pages, console exceptions, dead buttons, broken flows — and *unreliable for subtle correctness* — wrong sort order, off-by-one, quietly incorrect results. adapt is strong at detecting breakages and weaker at detecting subtle wrongness. Mitigations: optional API-level assertions when the UI cannot reveal the truth, and graduation of stable scenarios into deterministic Playwright tests.

**Other known risks:**

- **Self-consistency vs. user-correctness** — a self-judging loop can converge on internally consistent but user-wrong behavior.
- **Drift & reward-hacking** — the Dreamer is the highest-risk role; it is defended by the adversarial Critic, reality-grounded verification, a versioned north-star, and attempt limits.
- **Compounding error** over many cycles.
- **Cost & time** — autonomous loops in real browsers are not cheap.

**Build status — Phase A spine first, then layer outward:**

1. **Spine** — `validate → triage → repair → verify`.
2. **Demand engine** — Dreamer + Critic + Generator.
3. **Endurance & graduation** — long runs, a regression pool, graduating stable scenarios into deterministic tests, and budget guardrails.

---

## License

[MIT](./LICENSE) © Sotiris Bekiaris.

Provided as-is, without warranty of any kind. See [Read before you run this](#️-read-before-you-run-this) for the operational risks of running autonomous agents against a codebase.
