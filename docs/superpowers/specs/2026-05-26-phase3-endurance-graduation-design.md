# adapt — Phase 3 Design: Endurance & Graduation

**Date:** 2026-05-26
**Status:** Design approved; to be decomposed into three implementation plans. Builds on Phases 0–2 (all merged).
**Parent:** [adapt design blueprint](2026-05-25-adapt-design.md) §15 (Phase 3), §5 (Playwright graduation as the oracle-cost pressure valve). Builds on the [Phase 1 spine](2026-05-26-phase1-spine-design.md) and the [Phase 2 demand engine](2026-05-26-phase2-demand-engine-design.md).

---

## 1. Goal

Make adapt **run on its own, indefinitely and safely**, and stop paying the LLM-runner cost for scenarios that are already proven. Three additions: (a) robustness so a single cycle is safe to repeat forever; (b) **graduation** — a proven scenario becomes a deterministic Playwright test and leaves the LLM loop; (c) a bounded **continuous runner**. This is the "closed agent loop that works non-stop" from the original vision.

## 2. Settled decisions (from brainstorming)

1. **`adapt run`** is an internal, bounded continuous loop of `evolve` cycles. Guardrails stop it: `maxCycles`, `maxWallClockSeconds`, `maxConsecutiveErrors`; a configurable `pauseSeconds` separates cycles. Ctrl-C stops it cleanly. It streams to the console/decision log like `evolve`.
2. **Graduation is the regression strategy — not an LLM regression pool.** A scenario that passes `gradPassThreshold` **consecutive** times is *proven*; a Grad agent writes a deterministic Playwright spec into the target's test directory; the scenario is marked **`graduated`** and the LLM Runner **never runs it again** (the target's own CI runs the cheap deterministic test). The user explicitly does not want proven scenarios re-run by the expensive LLM runner — graduation is exactly the mechanism that retires them from the LLM loop while preserving coverage as deterministic tests.
3. **Contained graduation:** adapt writes the spec and marks the scenario graduated, but does NOT run the target's test suite itself — that's the target CI's job. The N-pass proof licenses the conversion; spec fidelity is verified downstream by the target's CI.

## 3. Architecture

Reuses everything: `runRole`, `runScenario`/`runReadyScenarios`, `runCycle`, `runEvolve`, the `Orchestrator`/`StateStore`/ledger, the `EventBus`/`DecisionLog`/console. New components:

```
src/orchestrator/passes.ts        # (or store methods) consecutive-pass tracking per scenario
src/agents/prompts/graduation.ts  # graduationPrompt + GradResultSchema
src/demand/dedupeDemand.ts        # demandDedupeKey(title) + filter against existing demands
src/orchestrator/graduate.ts      # graduateProven(deps) -> graduated scenario ids
src/orchestrator/run.ts           # runContinuous(deps) -> loop runEvolve under guardrails
src/cli/commands/run.ts           # adapt run
src/types.ts                      # MODIFIED: add "graduated" scenario status
src/orchestrator/lifecycles.ts    # MODIFIED: scenario transitions to "graduated"
src/config/schema.ts              # MODIFIED: limits.gradPassThreshold, playwrightTestDir, run guardrails
src/engine/mcp.ts                 # MODIFIED: "graduation" role mapping
src/orchestrator/cycle.ts         # MODIFIED: pass-tracking, re-drive reopened items, graduate step
src/orchestrator/runScenario.ts   # MODIFIED: selection skips graduated
src/demand/dream.ts               # MODIFIED: demand dedup
src/orchestrator/repair.ts        # MODIFIED: verifier inconclusive semantics
```

### 3.1 New role (permissions)

| Role | Source access | MCP servers | Writes |
|---|---|---|---|
| Graduation | read (the scenario + app for discovery) | Chrome DevTools (optional) | writes a Playwright `.spec.ts` into the target's test dir (NOT product code, NOT scenarios) |

`mcpServersFor("graduation", config)` → `chrome-devtools` when enabled; never Jira.

## 4. Robustness carryovers (Plan 10)

These make one cycle safe to repeat indefinitely:

- **Verifier infra-failure → `inconclusive`.** In `verifyWorkItem`, a missing/invalid/crashed verification result is treated as `inconclusive` (the work-item stays `ready-for-verification` for a later retry; it does NOT count as "still failing" and does NOT consume toward reopen/park). Only a genuine `verified:false` reopens. This fixes the Phase 1 carryover (a flaky infra failure could wrongly escalate to `needs-attention`).
- **Re-drive `reopened` work-items.** `runCycle` processes not only `triage.created` but also existing `reopened` work-items (and `triaged` stragglers), re-attempting implement→verify within attempt limits. Without this, a reopened item is never picked up again across cycles.
- **Demand dedup.** The Dreamer runs every cycle; `runDream` drops a proposed demand whose normalized title matches any existing non-`rejected` demand, so the backlog doesn't fill with duplicates.
- **`recoverIncomplete` at cycle start.** Each cycle calls `orchestrator.recoverIncomplete()` first, so a run stranded `running` by a crashed prior cycle resolves to `inconclusive` rather than lingering.

## 5. Graduation (Plan 11)

- **Consecutive-pass tracking.** The store tracks `consecutivePasses` per scenario. In `runCycle`, after each run: `passed` → increment; any non-passed terminal verdict → reset to 0. (Only *consecutive* passes count, so a scenario must be reliably green to graduate.)
- **`graduated` scenario status** (new, in `SCENARIO_STATUSES` + `SCENARIO_TRANSITIONS`). A `graduated` scenario is terminal in the LLM loop.
- **Selection skips graduated.** `runReadyScenarios` excludes `graduated` scenarios (runnable = `ready`/`active`/`regression` and not graduated).
- **`graduateProven(deps)`** (run in the cycle after the run/triage/repair stages): for each non-graduated scenario whose `consecutivePasses >= limits.gradPassThreshold`, invoke the Grad agent (`graduationPrompt`) to write a Playwright spec at `<targetRepo>/<playwrightTestDir>/<scenarioId>.spec.ts` (via `runAgent`; deliverable is the file). Node validates the file exists and is non-empty; on success, sets the scenario's frontmatter `status: graduated` (Node rewrites the scenario file's status — append-only-safe: only the status field changes) and rebuilds the registry. Returns the graduated scenario ids.
- **GradResult / contract:** the generator writes the spec file directly (like the Scenario Generator). Node validates by checking the expected path exists + non-empty; missing → logged no-op (scenario stays, retries next time it re-proves).

## 6. The continuous runner (Plan 12)

`runContinuous(deps)` loops:
```
recoverIncomplete (handled inside each runEvolve cycle)
for cycle in 1..maxCycles:
  if wall-clock exceeded -> stop
  run one runEvolve cycle, capturing its summary
  if the cycle threw / produced an engine error -> consecutiveErrors++ else reset
  if consecutiveErrors >= maxConsecutiveErrors -> stop
  emit a "cycle.completed" event
  sleep pauseSeconds (interruptible)
```
`adapt run <repo>` wires the bus → console/decision log, runs `runContinuous`, and stops on Ctrl-C. Returns a summary `{ cycles: Cycleish[], stoppedBy: "maxCycles"|"wallClock"|"errors"|"signal" }`.

**Config additions:** `limits.gradPassThreshold` (default 3); `playwrightTestDir` (default `"tests/adapt"`); `run` block: `maxCycles` (default 10), `maxWallClockSeconds` (default 3600), `pauseSeconds` (default 5), `maxConsecutiveErrors` (default 3).

## 7. Safeguards

- Every guardrail bounds `adapt run`; it cannot run truly forever without `maxCycles`/`maxWallClock` (defaults are finite — set them high for long runs).
- Graduation is append-only/non-destructive: the scenario file is preserved (only its `status` flips to `graduated`); the Playwright spec is additive in the target test dir.
- Only consecutively-passing scenarios graduate; a single failure resets the count.
- Verifier never produces a false `done` (inconclusive on infra failure).
- Demand dedup prevents backlog spam across cycles.
- All loops are bounded; no uncontrolled recursion.

## 8. Testing strategy

Stub-tested throughout, like Phases 0–2: a Grad stub writes a `.spec.ts`; assert proven scenario (N stub passes) → `graduated` + skipped by the runner next cycle; reopened work-item re-driven; verifier infra-failure → inconclusive (not reopened); demand dedup; and `adapt run` stops at `maxCycles`/`maxConsecutiveErrors`. The `docs/first-real-run.md` checklist gains an `adapt run` step.

## 9. Build order

Plan 10 (robustness) → Plan 11 (graduation) → Plan 12 (`adapt run`), each its own writing-plans cycle, executed and reviewed (Opus) before the next.

## 10. Open items (deferred)

- Running the generated Playwright spec from adapt to sanity-check it (the user chose "contained" — the target CI runs it). A future phase could add an optional `adapt verify-graduated` that runs the target test command.
- De-graduation (if a graduated scenario's deterministic test starts failing in the target CI, bringing it back into the LLM loop) — future.
- Real signals (analytics/user feedback) feeding the Dreamer — future.
- Spend/token budget guardrail (Phase 3 bounds by cycles + wall-clock; true cost-budgeting needs engine cost reporting) — future.
