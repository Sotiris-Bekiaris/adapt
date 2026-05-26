# adapt — Phase 1 Design: The Autonomous Spine

**Date:** 2026-05-26
**Status:** Design approved; to be decomposed into three implementation plans. Builds on Phase 0 (merged).
**Parent:** [adapt design blueprint](2026-05-25-adapt-design.md) §15 (Phase 1), §5 (oracle problem), §6–7 (roles/permissions), §13 (DB hooks), §14 (state machines).

---

## 1. Goal

Build the autonomous **validate-and-repair spine**: a bounded loop where coding agents execute user-level scenarios against a running app, turn real failures into tracked work, implement fixes, and *independently* verify the original scenario before anything is marked done. No human in the loop; the human watches via the Phase 0 console. This is the MVP measured by blueprint §17.

Phase 1 deliberately excludes the Dreamer/Critic/Generator (Phase 2) — scenarios are human-seeded for now.

## 2. Core principle realized

The orchestrator (Node, from Phase 0) is the deterministic spine. The *intelligence* lives in coding agents it launches one at a time, each with a tailored prompt, a specific MCP server set, and a **result-file contract**. Agents never decide their own completion conversationally — they write a schema-validated JSON artifact; the orchestrator validates it, transitions state, enforces limits, and streams events to the console.

> Node orchestrates and owns durable artifacts. Agents do the integrated, judgment work. They communicate only through validated files.

## 3. Settled decisions (from brainstorming)

1. **Result contract — agent writes a result JSON file.** Each agent is instructed to write a schema-conforming JSON to a known workspace path. After the agent exits, the orchestrator reads + validates it. Missing or invalid → treated as `inconclusive` (Runner) or a logged no-op (other roles). This is schema-enforced, fits the durable-artifact design, and is trivially testable with a stub that writes a fixture.
2. **Stub-testable; defer live wiring.** All Phase 1 logic is unit-tested with the Phase 0 `StubEngine` (scripted to write fixture result files), `echo` hook commands, and a local file tracker in temp dirs — no live `claude`, browser, or Jira. The real Claude Code + Playwright MCP + Jira MCP wiring is built behind seams and validated via a documented **"first real run"** checklist when the user plugs a real app.
3. **Jira via agents, not Node.** MCP is a coding-agent capability, not available to the Node orchestrator. So Triage/Implementation/Verification agents create and transition Jira issues *themselves* via the Jira MCP. Node owns the canonical local work-item JSON + the dedup index, and reads the Jira key back from the agent's result file. "Jira on/off" = whether the Jira MCP is exposed to those agents (`config.mcp.jira.enabled`).

## 4. Architecture

Reuses all of Phase 0: the `AgentEngine` seam (`StubEngine` in tests, `ClaudeCodeEngine` in real runs), the `Orchestrator` state machine + run ledger + SQLite store, the `EventBus` / `DecisionLog` / web console, and the workspace/config/scenario layer.

New components:

```
src/agents/
  roles.ts            # Role = { name, promptTemplate, mcp[], resultPath(ctx), resultSchema }
  runRole.ts          # runRole(engine, role, ctx): build AgentSpec, run (stream->bus),
                       #   read+validate result file -> typed result | inconclusive
  prompts/            # one prompt template per role (runner, triage, implementation, verification)
src/engine/
  mcp.ts              # config.mcp.* -> concrete Claude Code --mcp-config; per-role server selection
src/tracker/
  workItem.ts         # zod WorkItem schema + type
  localTracker.ts     # write/read work-items + dedup index (dedupeKey -> itemId)
  dedupe.ts           # dedupeKey(runRecord)
src/orchestrator/
  hooks.ts            # runHook(cmd, cwd): run scenario setup/teardown in the target repo
  cycle.ts            # runCycle(): one bounded validate->triage->repair->verify pass
src/cli/commands/
  runScenarios.ts     # adapt run-scenarios
  triageFailures.ts   # adapt triage-failures
  orchestrate.ts      # adapt orchestrate
```

### 4.1 Roles and the result contract

A **role** is a static definition: a prompt template, the MCP servers it needs, the working directory (always the target repo), the result-file path (derived from context, e.g. `scenario-runs/<runId>.json`), and the zod schema its result must satisfy.

`runRole(engine, role, ctx)`:
1. Render the prompt from the template + context (scenario text, evidence, paths, the exact result path to write).
2. Build an `AgentSpec` (role name, prompt, cwd = target repo, mcpServers from `mcp.ts`).
3. Run via the engine, forwarding every `AgentEvent` to the bus (→ console + decision log).
4. After exit: read the result file; validate against the role's schema.
   - Valid → return the typed result.
   - Missing / invalid / nonzero exit → return a role-appropriate fallback (`inconclusive` RunRecord for Runner/Verifier; `null`/logged no-op for Triage/Impl).

This single seam makes every role uniform, observable, bounded, and stub-testable.

### 4.2 Permissions per role (blueprint §7)

| Role | Source access | MCP servers | Writes code | Closes work |
|---|---|---|---|---|
| Runner | **no** | Playwright | no | no |
| Triage | read-only (evidence) | Chrome DevTools + Jira* | no | no |
| Implementation | yes | Chrome DevTools + Jira* | yes | **no** (→ ready-for-verification only) |
| Verification | preferably no | Playwright + Jira* | no | yes (only after pass) |

\*Jira MCP exposed only when `config.mcp.jira.enabled`. Source access is enforced by prompt + which directory/tools the agent is told to use (Phase 1 relies on prompt-level discipline; hard sandboxing is a later concern).

## 5. The three implementation plans

### Plan 4 — Scenario Runner

- **Runner role**: black-box. Given the scenario file (goal, steps, expected outcome, failure signals), the `appBaseUrl`, and Playwright MCP, it behaves like a user, then writes a `RunRecord` (Phase 0 schema) to `scenario-runs/<runId>.json` with `status` ∈ {passed, failed, blocked, flaky, invalid, inconclusive} plus evidence (failureStep, actual/expected, console/network errors, screenshots, notes).
- **DB hooks** (`hooks.ts`): orchestrator runs `scenario.hooks.setup` before the Runner and `teardown` after, in the target repo. Hook nonzero exit → scenario `blocked` (needs-environment-fix), run not attempted.
- **Orchestrator integration**: `createRun` → setup hook → `runRole(runner)` → validate result → `recordResult` (writes ledger, transitions run + scenario state) → teardown hook.
- **CLI**: `adapt run-scenarios <repo> [--scenario SCN-xxx]` runs ready scenarios (or one).
- **Tests (stub)**: StubEngine scripted to write fixture RunRecords (pass / fail / nothing). Assert: orchestrator records the verdict; missing/invalid file → `inconclusive`; hook failure → `blocked`; events reach the bus.

### Plan 5 — Failure Triage + work tracker

- **WorkItem schema** (`workItem.ts`): id, title, scenarioId, runIds[], expected, actual, reproSteps, evidence refs, classification (bug | environment | test-data | invalid-scenario | flaky | needs-human), severity, dedupeKey, status (Phase 0 WORK_ITEM_STATUSES), jiraKey?, labels.
- **dedupeKey** (`dedupe.ts`): `scenarioId | failureStep | normalizedActual | firstConsoleErrorSig | firstNetworkErrorSig`.
- **LocalTracker** (`localTracker.ts`): write/read work-items in `work-items/`; maintain a dedup index; on a matching key, append the new runId to the existing item instead of creating a duplicate.
- **Triage role**: reads recent failed/inconclusive runs (evidence only, read-only source), classifies, and for each *new actionable* failure asks the orchestrator (via its result) to create a work-item; when Jira MCP is enabled it also creates the Jira issue and returns the key. The agent result lists {dedupeKey, classification, severity, title, jiraKey?} per failure; Node persists the canonical work-item and updates the dedup index.
- **CLI**: `adapt triage-failures <repo>`.
- **Safeguards**: never create items for `blocked`/`invalid`/`inconclusive` unless configured; group failures sharing a root (one item, many runIds); cap at `limits.maxItemsPerRun`.
- **Tests (stub)**: fixture runs + scripted triage result → assert dedup (second identical failure appends, no new item), classification routing, cap enforcement, Jira-key passthrough when "enabled".

### Plan 6 — Implementation + Verification + orchestrate

- **Implementation role**: reads the work-item + scenario + evidence; works on a fix branch in the target repo (`adapt/<itemId>`); runs the target's checks; optionally self-checks via Chrome DevTools MCP; moves Jira → *ready-for-verification* (via MCP); writes a result {branch, summary, testsPassed}. **Never** closes the item, weakens the scenario, or deletes scenarios. Records a fix attempt; `canAttempt` gate before invoking.
- **Verification role** (independent process invocation; must not be the implementation step): reruns the **exact** scenario via the Runner flow against the fixed app. Pass → Jira *done* (via MCP), scenario → `regression`, work-item → `done`. Fail → work-item → `reopened`, increment verification attempt; on attempt-limit breach → `needs-attention` (parked, surfaced in console).
- **The cycle** (`cycle.ts`) / `adapt orchestrate <repo>`: one bounded pass —
  1. select ready scenarios → for each: setup → run → record → teardown;
  2. triage failed/inconclusive runs → create/dedupe work-items (≤ maxItemsPerRun);
  3. for each new actionable work-item, while under limits: implement → verify → transition.
  No uncontrolled infinite loop; one pass per invocation. Wires `orchestrator.emit` → `bus.publish(fromOrchestratorEvent(e))` so the whole cycle streams to the console (also closes the Phase 0 carryover that wired only agent events).
- **Tests (stub)**: scripted impl + verification results drive a full in-memory cycle on fixtures; assert state transitions, fixer≠verifier separation, impl-never-closes, attempt-limit parking, reopen-on-fail, console receives orchestrator + agent events.

## 6. Error handling & safeguards (Phase 1 specifics)

- Agent crash / nonzero exit / missing or invalid result file → `inconclusive` (Runner/Verifier) or logged no-op (Triage/Impl); never a false "pass".
- Attempt limits: `maxFixAttempts`, `maxVerificationAttempts` (Phase 0 store); breach → park work-item `needs-attention`, continue the cycle with other work.
- Hook failure → scenario `blocked` / `needs-environment-fix`.
- Implementation agent cannot close work items or move Jira to *done*; only Verification can, and only after a real pass.
- The same invocation never both implements and verifies (separate `runRole` calls with different roles).
- Never weaken expected outcomes or delete failing scenarios (prompt-level rule + no code path that mutates scenario files during the cycle).
- `orchestrate` does one bounded pass; continuous scheduling is deferred.

## 7. Testing strategy

- 100% of Phase 1 logic is unit-tested with the `StubEngine` (scripted to write fixture result files), `echo`-based hook commands, and the `LocalTracker` in temp dirs — no live `claude`, browser, or Jira. CI-clean, like Phase 0.
- A committed **"first real run" checklist** (`docs/`) describes plugging a real full-stack app: configure `appBaseUrl`/`startCommand`/hooks, set `engine.type=claude-code`, enable Playwright + Jira MCP, seed 1–3 scenarios, and run `adapt run-scenarios` then `adapt orchestrate`. This is where the oracle gets proven on real hardware, by the user.

## 8. Build order

Plan 4 → Plan 5 → Plan 6, each its own writing-plans cycle, executed and reviewed before the next (same subagent-driven + Opus-review discipline as Phase 0). Each plan produces working, independently-testable software.

## 9. Open items (deferred, not blocking)

- Hard source-access sandboxing for the Runner/Verifier (Phase 1 uses prompt-level discipline).
- Cross-process orchestrator run rehydration + persisted `seq` (Phase 0 carryover; only matters once `orchestrate` runs continuously — Phase 3).
- Continuous/scheduled cycles and budget guardrails (Phase 3).
- Playwright-test graduation of stable scenarios (Phase 3).
