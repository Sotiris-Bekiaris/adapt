# Dedup-aware Critic & Guaranteed Scenario Seed Data — Design

Date: 2026-06-13
Status: approved (design)

## Problem

Two gaps in the demand → scenario → run pipeline:

1. **Cross-cycle scenario duplication.** The only dedup that prevents the same
   scenario being created cycle after cycle is `demandTitleKey` in `dream.ts`
   (lowercase + whitespace-collapse on the demand title). It catches only
   byte-identical titles. "Login with expired password" vs "Expired-password
   login fails" produce two scenarios. The Critic — the agent that *could* judge
   overlap — sees each demand in isolation with zero corpus context.

2. **Unmanaged database state per scenario.** The runner is a black-box browser
   agent forbidden from reading the repo, so it cannot itself create the data a
   scenario assumes (a specific user, records). Data must arrive via the
   scenario's `hooks.setup`. But the Generator writes the scenario steps
   ("log in as alice") without ever being told to write the matching seed hook
   that provisions alice. The data-need and the seed are disconnected, and a
   scenario can run against an empty/unknown DB and fail for the wrong reason.

Lane-level isolation (`environment.up/reset/down`, per-lane git worktree +
docker compose project + port base) already gives each lane its own stack and
is **out of scope** here. This design addresses per-scenario data and demand
dedup only.

## Approach

Three independent workstreams.

### A. Semantic dedup folded into the Critic

Dedup is a product-owner judgment ("do we already cover this?"), so it belongs
in the existing Critic rather than a new agent. The Critic already gates every
proposed demand one-at-a-time and may read source.

Changes:

- **`src/demand/demand.ts`**
  - Add `"duplicate"` to `DEMAND_STATUSES` (now `proposed | approved | rejected | duplicate`).
  - Add field `duplicateOf: z.string().nullable()` to `DemandSchema` — the
    `SCN-xxx` or `DMD-xxx` id this demand overlaps. `newDemand` sets it `null`.
- **`src/agents/prompts/critic.ts`**
  - `CriticVerdictSchema.decision` enum → `["approved", "rejected", "duplicate"]`.
  - Add `duplicateOf: z.string().nullable().default(null)` to the verdict schema.
  - `CriticPromptCtx` gains a `corpus` string. The prompt injects the existing
    corpus and instructs: *if this demand is already substantially covered by an
    existing scenario or another pending/approved demand, decide `duplicate` and
    set `duplicateOf` to that id. Judge by meaning, not wording.*
- **`src/demand/critique.ts`**
  - Build the corpus once per pass: existing scenarios via `rebuildRegistry`
    formatted as `id · title · persona`, plus pending+approved demands via
    `store.list()` formatted as `id · title`. Pass to `criticPrompt`.
  - On verdict `duplicate`: persist the demand with `status: "duplicate"` and
    the returned `duplicateOf`; exclude it from the approved list (so no
    scenarios are generated for it).
- **`src/demand/dream.ts`**
  - Keep `demandTitleKey` but demote it: it remains only an in-batch / exact
    prefilter (stops the Dreamer emitting the identical title twice in one pass,
    and against existing non-rejected demands). The semantic safety net is now
    the Critic. The `seen` set continues to exclude only `rejected`; `duplicate`
    demands stay in `seen`, so the Dreamer won't re-propose the same title, and
    a reworded re-dream is caught by the Critic next pass.

### B. Generator writes the seed hook

Root cause of the empty-DB risk: the Generator writes steps that assume data but
never writes the hook that seeds it. Fix at the source — the same agent that
reads the repo and writes the steps also writes the matching seed.

Changes:

- **`src/agents/prompts/generator.ts`**
  - Add `hooks.setup` / `hooks.teardown` to the frontmatter template shown to the
    agent.
  - Add a rule: *If the scenario depends on data existing before the user acts
    (a specific account, records, etc.), you MUST emit a `hooks.setup` command
    that seeds exactly that data into the isolated DB, and a `hooks.teardown`
    that cleans it. Discover the project's seed tooling (you may read source).
    If the scenario needs no preexisting data (e.g. a fresh signup), omit hooks.*

The scenario schema (`src/scenarios/schema.ts`) already supports
`hooks.setup`/`hooks.teardown`; no schema change needed for B.

### C. Global default + missing-hook visibility

- **`src/config/schema.ts`**
  - Add `requireSetupHook: z.boolean().default(false)` to the `hooks` object.
- **`src/orchestrator/runScenario.ts`**
  - Resolve `const setupCmd = scenario.meta.hooks?.setup ?? config.hooks.setup`.
  - If `setupCmd` is undefined (no scenario-level and no global setup resolves):
    - `config.hooks.requireSetupHook === true` → record the run as `blocked`
      with note `"no setup hook resolved; DB state unmanaged"` and do **not**
      run the runner.
    - otherwise → emit a visible warning event through `sink` (an `AgentEvent`
      with `kind: "warning"`, `role: "runner"`, text naming the scenario and
      that DB state is unmanaged), then run as today.
  - When `setupCmd` is defined, behaviour is unchanged (existing `runHook` path).
- No silent placeholder seed command is scaffolded — an `echo` that exits 0 but
  seeds nothing masks the problem worse than a warning. The example scenario
  (`scaffold.ts` `EXAMPLE_SCENARIO`) already documents the hooks shape; keep it.

## Data flow (after change)

```
dream ──(title prefilter)──> proposed demands
  └─> critique (corpus-aware) ──> approved | rejected | duplicate
        └─ approved only ──> generate (writes steps + seed hooks)
                               └─> scenario files (.adapt/scenarios)
run cycle:
  resolve setup = scenario.hooks.setup ?? config.hooks.setup
    none + requireSetupHook -> blocked
    none                    -> warn + run
    present                 -> runHook(setup) -> runner -> teardown
```

## Testing

- **Critic dedup** (`test/.../critique` or new): stub engine returns a
  `duplicate` verdict → demand persisted as `duplicate` with `duplicateOf`,
  absent from approved. Assert the corpus (scenario + demand ids) is rendered
  into the prompt.
- **Generator prompt** (`test/.../generator` prompt test): asserts the frontmatter
  template includes `hooks.setup`/`hooks.teardown` and the seed instruction.
- **runScenario seed guard** (`test/orchestrator/runScenario.test.ts`):
  - no resolved setup + `requireSetupHook: true` → status `blocked`, runner not invoked.
  - no resolved setup + default → runs, warning event emitted to sink.
  - scenario-level setup present → `runHook` invoked, runs normally (existing).
- **Dream prefilter**: existing title-key tests stay green (behaviour preserved).

## Out of scope

- Lane-level environment lifecycle (`environment.up/reset/down`) — already
  provides per-lane stack isolation.
- Structured per-scenario data manifests / fixtures DSL — the freeform body plus
  a generator-authored seed hook is sufficient; revisit only if drift persists.
