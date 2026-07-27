# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

adapt is not published to npm and is not git-tagged. Versions here mark notable states of `main`;
install by cloning the repository. Dates are taken from the commit history.

## [Unreleased]

Not released, not tagged, not published. This is the open-source release pass in progress —
everything needed to hand the repository to someone who has never seen it — plus two default
changes. The orchestrator's state machine, the demand engine, and the agent prompt text are
untouched; what moved is which branch of a prompt a default run takes.

### Added

- Contributor documentation: `CONTRIBUTING.md` (setup, `npm run check`, the stub-engine testing
  rule, commit conventions), `SECURITY.md`, and `CODE_OF_CONDUCT.md`.
- `docs/ARCHITECTURE.md` — the module map and the path a scenario takes through the system — plus
  `docs/README.md` and `scripts/README.md` as indexes for those two directories.
- GitHub Actions CI (`.github/workflows/ci.yml`): typecheck, tests, and a staleness check on the
  generated JSON Schemas, across Node 20 and 22. Dependabot for npm and Actions.
- Issue forms (bug report, feature request) and a pull request template under `.github/`. The bug
  form's reproduction placeholder now mirrors the README quickstart with absolute paths, and the
  template chooser points questions at the issue tracker rather than at Discussions, which is off by
  default on a new repository.
- `.github/workflows/pages.yml` — publishes `readme.html` as the GitHub Pages landing page
  (`index.html`), with `story.html` alongside it. The site is assembled in the workflow; neither
  HTML file is generated or modified. Requires Pages source to be set to "GitHub Actions" in repo
  settings.
- `.nvmrc` and `.editorconfig`.
- `npm run check` — typecheck plus the test suite in one command, the same gate CI runs.
- `scripts/deepseek.env.example` and `scripts/jira.env.example`, so the two gitignored credential
  files have committed templates.
- `adapt --version`, and `--fail-on-failure` on `run-scenarios` for scripting a pass/fail gate.
- This changelog.

### Changed

- `engine.skipPermissions` is now read. It was declared in `src/config/schema.ts` with no call site,
  so setting it to `false` changed nothing; the commands that drive agents build their engine through
  `engineFor()` (`src/cli/commands/engineFor.ts`), which passes the configured value through, and
  `false` now withholds `--dangerously-skip-permissions`. The default is unchanged (`true`), and
  `adapt init` still runs the Scout before any config exists, so that one invocation is not covered.
- Jira is now **opt-in**: `mcp.jira.enabled` defaults to `false`, reversing the previous default.
  `mcp-atlassian` and Jira Server/DC are publicly available, but requiring a running Jira instance
  to try adapt is too heavy a default. Work-items live in `<target>/.adapt/work-items/` through the
  built-in local tracker (`src/tracker/localTracker.ts`) either way; enabling Jira additionally
  hands the `jira` MCP server to triage, implementation, and verification. The Jira integration
  itself is unchanged.
- Turning Jira on without a project key is now rejected at load time. `loadConfig`
  (`src/config/load.ts`) fails with an actionable message when `mcp.jira.enabled` is `true` and
  `jira.projectKey` is empty, instead of letting the Triage agent discover mid-cycle that it was
  told to file into project `""`.

### Removed

- Config keys that no code read: `jira.enabled`, `jira.baseUrl`, `jira.defaultIssueType`, and
  `jira.transitions.*`. `mcp.jira.enabled` was always the real gate, the connection comes from the
  `JIRA_*` environment variables, and the issue type and workflow transition names are literals in
  the agent prompts. `jira.projectKey` is the one key that reaches a prompt and it stays. An older
  `config.json` carrying the retired keys still loads — they are ignored, not rejected.
- Agent result fields that were parsed and then discarded: `jiraMovedTo` on the Implementation and
  Verification results, and `linkedJiraIssue` on `RunRecord`. Nothing read them, and adapt cannot
  verify a Jira transition it never observes, so asking an agent to self-report one only invited
  false confidence. Existing `.adapt/scenario-runs/*.json` still parse; the field is ignored.
- `engines.node` is now `>=20`, matching the CI matrix and the `better-sqlite3` prebuilds.
- CLI errors print as a single line and exit `1`, or `2` when the target repo is not configured;
  `--console` and `--port` reject non-integer and out-of-range values instead of binding something
  unexpected; `ADAPT_DEBUG=1` restores the stack trace.
- `lane reset` and `lane destroy` print what they will destroy and require confirmation, with `-y` to
  skip it and a refusal (rather than a silent proceed) when there is no terminal to ask.
- README rewritten around what the system is, how to try it with no API key, and what it costs to run
  for real.

### Fixed

- A detached lane loop (`adapt lane start --detach`) now serves its manifest's console port, so the
  monitor streams it live instead of falling back to replaying its decision log.

## [0.1.0] - 2026-07-26

First public state of the repository. Everything below was built between 2026-05-25 and 2026-07-26
and is exercised end to end by the test suite against the deterministic stub engine — no live model,
no browser, no network.

### Added

**Rails and workspace**
- `adapt init` scaffolds a `.adapt/` workspace inside a target repo — idempotently, reporting what it
  created versus skipped.
- zod `AdaptConfigSchema` with defaults, plus a loader that reports validation failures as
  human-readable bullets instead of a zod dump.
- JSON Schema export (`npm run schemas`) generating committed
  `src/schemas/generated/adapt-config.schema.json` and `scenario-meta.schema.json` from the zod
  definitions.
- Scenario markdown: frontmatter schema, parser, and a rebuildable `scenarios/index.json` registry.
- A Scout agent that reads the target repository at `init` time and drafts `.adapt/north-star.md`,
  falling back to a template when no agent engine is available.

**Orchestrator**
- Lifecycle transition tables for scenarios, runs, and work-items, enforced by a generic transition
  validator — the orchestrator is deterministic code, never a model.
- SQLite state store (runs, scenario state, attempt counters) plus an append-only run ledger, with
  crash recovery for incomplete runs and reaping of orphaned `running` runs on loop start.
- `runScenario` — DB setup/teardown hooks, the Runner agent, and a validated run record. Scenarios
  that resolve no setup hook can be hard-blocked via `hooks.requireSetupHook`.
- `triageFailures` — deduplicated, classified work-items from failed runs, with a deterministic
  dedupe key and a local work-item store.
- `runCycle` — one bounded autonomous pass: validate → triage → repair → verify, with per-item fix
  and verification attempt limits, re-driving of in-flight items, and recovery of stranded runs.
- `graduateProven` — a scenario that passes `gradPassThreshold` times consecutively is converted into
  a deterministic Playwright spec and marked `graduated`.
- `runContinuous` — the endurance loop behind `adapt run`, with cycle, wall-clock, pause, and
  consecutive-error guardrails, honouring the lane control file for pause/stop/maxCycles.

**Demand engine**
- Demand model and store, plus an append-only north-star ambition writer.
- Dreamer → Critic → Generator stage: proposed demands are gated adversarially, deduplicated against
  existing non-rejected demands, and approved ones become validated scenario files. The Generator
  emits seed hooks for data-dependent scenarios.
- `adapt evolve` — one full evolutionary pass: dream → critique → generate, then the spine.

**Agent engine**
- `AgentEngine` interface with two implementations: a Claude Code headless adapter (spawns `claude`
  with `--output-format stream-json`, parses the stream line by line) and a deterministic
  `StubEngine` used by the entire test suite.
- Per-role MCP server selection: Playwright for the black-box roles (runner, verification), Chrome
  DevTools for the white-box roles (triage, implementation, dreamer, generator, graduation), Jira for
  triage/implementation/verification only. Playwright runs `--isolated` so session state cannot leak
  between scenarios.
- `runRole` — runs an agent, then reads and zod-validates the JSON result file it was told to write,
  clearing any stale file first.
- Agent prompts, each with its own result schema: runner, triage, implementation, verification,
  dreamer, critic, generator, graduation, scout.

**Baselines and lanes**
- `adapt baseline create|list` — tag the target's current state as a named fork point.
- `adapt lane create|list|start|stop|reset|destroy` — parallel evolutionary lineages as git
  worktrees, each with its own branch, allocated port range, optional pinned model, and lifecycle
  driven by target-supplied `environment.up`/`down`/`reset` commands.
- Lane loop supervision with a pidfile, and a `control.json` file for pause / stop / maxCycles.

**Observability**
- Generic event bus with a replay buffer, normalized console events, and an append-only NDJSON
  decision log.
- `adapt console` — HTTP + WebSocket server and a dependency-free mission-control dashboard.
- `adapt monitor` — multi-lane console with a Stream view, a cycle-grouped Flow view, per-lane and
  global control buttons, and a `maxCycles` input.
- `adapt run --console <port>` streams a running loop to the dashboard.

**Project**
- MIT licence, `story.html` interactive walkthrough, `readme.html` project page, and the design
  specs and implementation plans under `docs/superpowers/` that the source cites as "blueprint §N".

### Changed

- `run.maxCycles` and `run.maxWallClockSeconds` default to `null` (unbounded) rather than finite
  values; bound them explicitly before an unattended run.
- Jira (via the `mcp-atlassian` MCP server) is enabled by default, with credential wiring that keeps
  Personal Access Token auth and Cloud basic auth mutually exclusive so an ambient Cloud token cannot
  hijack a self-hosted run.
- Claude Code is invoked with `--dangerously-skip-permissions` by default; agents act without an
  approval step.
- The Claude Code engine closes the child's stdin, removing a 3s startup stall and a spurious
  `agent.error` on every agent run.

### Fixed

- Verifier infrastructure failures are recorded as `inconclusive` rather than "still failing", so a
  broken environment no longer looks like a failed fix.
- `runContinuous` is guardrail-aware around pauses and prefers an explicit stop request over a stale
  graduation.
- Monitor: step status is derived from the exit code rather than from benign stderr output; non-agent
  events no longer corrupt cycle segmentation; restart waits for the loop to stop before respawning.
- `recoverIncomplete` rewrites the ledger file as well as the store, so the two cannot diverge.
