# adapt — Phase 2 Design: The Demand Engine

**Date:** 2026-05-26
**Status:** Design approved; to be decomposed into three implementation plans. Builds on Phase 0 + Phase 1 (both merged).
**Parent:** [adapt design blueprint](2026-05-25-adapt-design.md) §8 (demand engine), §6 (Dreamer/Critic/Generator), §15 (Phase 2). Builds directly on the [Phase 1 spine](2026-05-26-phase1-spine-design.md).

---

## 1. Goal

Give the organism the ability to **choose its own work** — to dream up what should exist next, not just fix what breaks. A *demand stage* runs ahead of the Phase 1 cycle: the **Dreamer** proposes ambition + concrete demands, the **Critic** challenges them (adversarial pairing), and the **Scenario Generator** turns approved demands into the user-level scenario files the Phase 1 spine already executes. This is what makes adapt an organism with "no success point" rather than a QA-repair bot.

## 2. Settled decisions (from brainstorming)

1. **The Dreamer raises the ceiling by extending `north-star.md` itself.** The genome grows: the Dreamer proposes at most one new *ambition* per cycle, which is appended (append-only, never editing/deleting prior content) and committed to git — you watch ambition evolve in history. The Critic and the git trail are the safeguards. To keep the write deterministic and committable, **Node performs the append** from the Dreamer's proposed text (the agent proposes; Node writes), consistent with "Node owns artifact writes."
2. **A new `adapt evolve` command runs the full evolutionary pass** — demand stage (Dreamer → Critic → Generator) then the existing Phase 1 `runCycle`. `adapt orchestrate` stays as the repair-only loop. Clean layering: *orchestrate works what exists; evolve also invents.*

## 3. Architecture

Same spine pattern as Phase 1, reused wholesale: the `runRole` result-file seam, the `AgentEngine` (StubEngine in tests / ClaudeCodeEngine in real runs), `mcpServersFor`, the `Orchestrator`/`EventBus`/`DecisionLog`/console, the `LocalTracker`, and `runCycle`. The demand stage is new code that produces the scenarios `runCycle` consumes.

```
src/agents/prompts/
  dreamer.ts          # dreamerPrompt + DreamResultSchema
  critic.ts           # criticPrompt + CriticVerdictSchema
  generator.ts        # generatorPrompt + GenerateResultSchema
src/demand/
  demand.ts           # zod Demand schema + type + newDemand()
  demandStore.ts      # LocalDemandStore: list/create/update/nextId in .adapt/demands/
  northStar.ts        # appendAmbition(targetRepo, text, now) — append-only write
  dream.ts            # runDream(deps): Dreamer -> persist demands + append ambition
  critique.ts         # runCritique(deps): Critic per proposed demand -> approve/reject
  generate.ts         # runGenerate(deps): Generator per approved demand -> scenario files
  demandStage.ts      # runDemandStage(deps): dream -> critique -> generate -> summary
src/orchestrator/
  evolve.ts           # runEvolve(deps): runDemandStage then runCycle
src/cli/commands/
  evolve.ts           # adapt evolve
src/engine/mcp.ts     # MODIFIED: add dreamer/critic/generator role mappings
src/config/schema.ts  # MODIFIED: add limits.maxDemandsPerCycle, limits.maxScenariosPerDemand
```

### 3.1 New roles (permissions, blueprint §6–7)

| Role | Source access | MCP servers | Writes product code | Writes artifacts |
|---|---|---|---|---|
| Dreamer | read | Chrome DevTools (explore, optional) | no | proposes ambition + demands (Node writes) |
| Critic | read | none | no | verdicts (Node writes) |
| Scenario Generator | read (discovery only) | Chrome DevTools (explore, optional) | no | writes black-box scenario files |

None of the three touch Jira or write product code. `mcpServersFor` is extended: `dreamer`/`generator` → `chrome-devtools` when enabled; `critic` → `[]`.

## 4. Artifacts

- **Demand** — `.adapt/demands/DMD-###.json`:
  ```
  { id, title, rationale, proposedScenarios: string[], source: "dreamer",
    status: "proposed" | "approved" | "rejected", critique: string | null, createdAt }
  ```
- **north-star.md** — append-only. Node appends a section per accepted ambition:
  ```
  ## Ambition <ISO timestamp>
  <Dreamer's proposed ambition text>
  ```
- **Scenarios** — the Generator writes standard scenario files (Phase 1 format) into `.adapt/scenarios/`, `status: ready`, `source: agent-discovered`. Additive only.

## 5. Result contracts (result-file pattern, reused from Phase 1)

- **DreamResult** (`dream-<cycleId>.json`): `{ ambition: string | null, demands: [{ title, rationale, proposedScenarios: string[] }] }`. Node: if `ambition` non-null, append to north-star; persist each demand (assign `DMD-###`, status `proposed`), capped at `maxDemandsPerCycle`.
- **CriticVerdict** (`critic-<demandId>.json`): `{ decision: "approved" | "rejected", critique: string }`. Node sets the demand's status + critique.
- **GenerateResult** (`generate-<demandId>.json`): `{ scenarios: [{ filename }] }` — the Generator **writes the scenario files directly**; the result lists them. Node validates each created file against the scenario schema (invalid → skipped, logged) and rebuilds the registry. Cap per demand at `maxScenariosPerDemand`.

Missing/invalid result → that step is a logged no-op (no demand / no scenario), never a crash — same safety property as Phase 1.

## 6. The demand stage & evolve

`runDemandStage(deps)`:
1. **Dream** (`runDream`): one Dreamer `runRole` → persist demands (cap) + append ambition.
2. **Critique** (`runCritique`): for each `proposed` demand, one Critic `runRole` → set `approved`/`rejected` + critique.
3. **Generate** (`runGenerate`): for each `approved` demand, one Generator `runRole` → validate + register new scenarios (cap per demand).
Returns `{ ambitionAppended, demands: Demand[], scenariosCreated: string[] }`.

`runEvolve(deps)` (= `adapt evolve <repo>`): `runDemandStage` → `runCycle` (the Phase 1 spine on the expanded scenario set) → commit the workspace artifact changes (north-star, demands, new scenarios) in the target repo as one commit. Wires `emit`/`sink` to the bus → decision log + console, exactly like `orchestrate`. One bounded pass.

## 7. Safeguards (Phase 2 specifics)

- **Critic gate:** only `approved` demands become scenarios.
- **Append-only genome:** the Dreamer appends ≤1 ambition/cycle; Node never edits or deletes existing north-star content or existing scenarios.
- **Caps:** `maxDemandsPerCycle`, `maxScenariosPerDemand`.
- **Additive scenarios:** generation only adds files; it never overwrites an existing scenario id (collision → skip + log).
- **Bounded:** the demand stage is one pass; `evolve` is one pass.
- Generated scenarios enter at `status: ready` (the Critic's approval is the gate, since there's no human).

## 8. Testing strategy

100% stub-tested, like Phases 0–1: a multi-role StubEngine writes `DreamResult` / `CriticVerdict` / scenario files keyed on `spec.role`. Assert: demands persisted with ids + cap enforced; north-star appended; approved → scenarios created & registered; rejected → skipped; invalid generated scenario → skipped; then `runEvolve` runs `runCycle` on the expanded set and streams events. No live `claude`/browser. The `docs/first-real-run.md` checklist gains an `adapt evolve` step.

## 9. Build order

Plan 7 (Demand model + Dreamer + Critic) → Plan 8 (Scenario Generator) → Plan 9 (`adapt evolve` + integration), each its own writing-plans cycle, executed and reviewed (Opus) before the next, same discipline as Phases 0–1.

## 10. Open items (deferred, not blocking)

- Demand deduplication (a Dreamer could re-propose a similar demand across cycles) — Phase 3.
- Pruning/lifecycle for `rejected` demands and stale ambitions — Phase 3.
- Carryover from the Phase 1 final review: verifier infra-failure → `inconclusive` semantics; re-driving `reopened` items; `Orchestrator.setScenarioState` passthrough. These remain Phase 3 concerns and are unaffected by Phase 2.
- Whether the Dreamer should consume real signals (analytics/feedback) vs. pure north-star reasoning — future; Phase 2 reasons from north-star + product + run history only.
