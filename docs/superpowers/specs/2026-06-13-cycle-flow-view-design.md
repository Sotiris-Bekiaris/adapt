# Cycle-Grouped Flow View ("Cycles" tab) — Design

Date: 2026-06-13
Status: Approved, ready for implementation plan

## Problem

The multi-lane monitor's focused-lane pane renders every event of a lane into
per-role columns (one column per agent role) plus a flat "decision timeline"
aside. All cycles are flattened into the same columns with no cycle boundary, so
each agent is an endless independent scroll. To debug a single flow you must
visually spot which events belong to which cycle, by hand. There is no way to
see a cycle as an ordered agent-to-agent pipeline, nor to see how one agent's
output became the next agent's input.

## Goal

Add a **Cycles** view to the focused-lane pane that:

1. Groups events by orchestration **cycle**.
2. Within a cycle, presents the agents as **ordered steps** (the pipeline).
3. Lets you expand a step to see its **INPUT** (the actual prompt the agent
   received, labeled with the prior step it came from) and its **OUTPUT**.

This is added **alongside** the existing view via a `[ Stream | Cycles ]`
toggle. The current columns + timeline rendering is preserved unchanged as
"Stream". The new view defaults to **Cycles**.

Scope is the multi-lane monitor only (`monitor.html` / `monitor.js` / a new
`cycles.js`). The single-lane console (`app.js`) is intentionally untouched.

## Background: the data

Events reach the monitor client as `ConsoleEvent`
(`src/observability/events.ts`):

```ts
interface ConsoleEvent {
  channel: "agent" | "orchestrator";
  role: string;
  kind: string;
  at: string;       // ISO timestamp
  text?: string;
  tool?: string;
  data?: unknown;
  lane?: string;
}
```

Relevant kinds:

- Orchestrator cycle boundaries (`src/orchestrator/run.ts`):
  `cycle.start`, `cycle.completed`, `cycle.error`, each carrying a numeric
  `data.cycle`. (`fromOrchestratorEvent` folds the event's extra fields into
  `data`, so `cycle` lands in `data.cycle`.)
- Agent lifecycle (`src/engine/types.ts`):
  `agent.start`, `agent.thinking`, `agent.tool_call`, `agent.tool_result`,
  `agent.text`, `agent.error`, `agent.exit`. Each carries `role`.

Inside one cycle, `runEvolve` runs the demand agents in sequence
(dreamer → generator → critic → scout …). A role can run more than once per
cycle (e.g. `critic` loops per proposed demand).

**Gap:** the agent's prompt is passed via `AgentSpec.prompt` but is **not**
emitted on any event. `agent.start` today is `{ kind, role, at }` only. To show
a faithful INPUT block we must log the prompt.

## Design

### Component 1 — Capture the prompt (engine)

Emit the prompt as structured data on `agent.start`. This is the only non-UI
change.

- `src/engine/claudeCode.ts` (~line 85): the `agent.start` event gains
  `data: { prompt: spec.prompt }`.
- `src/engine/stubEngine.ts` (~line 22): same addition, so tests and the stub
  engine carry the prompt too.

No change to `fromAgentEvent` — it already forwards `data` onto the
`ConsoleEvent`, so the prompt flows through the lane's NDJSON decision log and
the live WS stream automatically.

Rationale for `data.prompt` (not `text`): `text` is reserved for thinking/text
output; keeping the prompt in `data` avoids overloading a field the Stream view
already renders.

### Component 2 — Cycle/step model (pure, testable)

New module `src/observability/public/cycles.js` exporting a pure function:

```js
// events: ConsoleEvent[] in chronological order
// returns: Cycle[]
export function buildCycles(events) { ... }
```

Shapes:

```
Cycle = {
  cycle: number | null,         // null for the synthetic pre-cycle bucket
  status: "running" | "done" | "error",
  startedAt: string | null,
  steps: Step[],
}

Step = {
  index: number,                // 1-based position within the cycle
  role: string,
  status: "running" | "done" | "error",
  input: string | null,         // data.prompt from agent.start
  output: string,               // concatenated agent.text
  summary: string,              // last non-empty text, truncated
  events: ConsoleEvent[],       // raw events of this step, in order
}
```

Segmentation rules:

- Walk events in order.
- `cycle.start` opens a new cycle (`status: "running"`, `cycle = data.cycle`,
  `startedAt = at`). `cycle.completed` closes the open cycle as `done`;
  `cycle.error` closes it as `error`.
- Agent (and other non-cycle) events are assigned to the currently open cycle.
  Events that arrive before any `cycle.start` go into a synthetic pre-cycle
  bucket (`cycle: null`) so nothing is dropped.
- Within a cycle, `agent.start` opens a step (`role`, `input = data.prompt`).
  Subsequent agent events for that run accumulate into the step. `agent.exit`
  closes the step (`done`, or `error` if an `agent.error` was seen). A step left
  open when the model is built is `running`.
- A role that starts again after its prior run exited becomes a new, separately
  numbered step.
- `output` = concatenation of the step's `agent.text` event texts.
  `summary` = the last non-empty `text` in the step, truncated to a fixed length
  (e.g. 80 chars); falls back to the step's terminal `kind` if there is no text.

This function takes no DOM and is unit-tested directly with vitest.

### Component 3 — Rendering (monitor.js + monitor.html)

`monitor.html`:

- Add toggle controls to the focus header: two buttons, `Stream` and `Cycles`.
- Add a `Cycles` view container (accordion root) alongside the existing
  `#agents` / `#timeline` (Stream) containers. Exactly one view is visible at a
  time.
- Add styles for: toggle buttons (active state), cycle headers (number, status
  dot reusing the running/done color language already in the sidebar), step rows,
  and the expanded INPUT/OUTPUT blocks.

`monitor.js`:

- Track `viewMode` ∈ `{ "stream", "cycles" }` for the focused lane, defaulting
  to `"cycles"`. Toggling re-renders without refetching.
- **Stream** path: unchanged — the existing `column()` / `render()` / timeline
  code stays as-is and drives the Stream container.
- **Cycles** path: call `buildCycles(events)` over the focused lane's buffered
  events (the existing per-lane buffer / replayed history), then render:
  - One accordion entry per cycle, **newest cycle on top**.
  - Cycle header: `Cycle N` · status dot · start time · step count. The newest
    (and any `running`) cycle is auto-expanded; others collapsed.
  - Expanded cycle → ordered step rows: `① role · status · summary`.
  - Click a step row → toggle an inline detail with an **INPUT** block (labeled
    `from ② <prevRole>` when a prior step exists; for the first step in a cycle,
    label it as the cycle's seed/no prior step) and an **OUTPUT** block.
- Live update: on each new event for the focused lane, if `viewMode` is
  `cycles`, rebuild the model from the buffer and re-render the Cycles view.
  Preserve which cycles/steps are expanded across re-renders (track expanded
  keys by cycle number + step index). The running cycle updates in place.
- **Security:** keep the existing textContent-only rule. Prompts and outputs are
  untrusted; build all nodes with `textContent` / `createTextNode`, never
  `innerHTML`.

The INPUT "from ② generator" label is derived from step ordering within the
cycle (the previous step's role), not from any guarantee that the prompt was
literally the prior output — it marks the pipeline position. The INPUT *content*
is the agent's real prompt (Component 1).

## Testing

- **Engine prompt emit** (`claudeCode` + `stub`): `agent.start` carries
  `data.prompt` equal to the spec prompt.
- **`buildCycles` unit tests** (vitest, no DOM):
  - Multi-agent cycle → one Cycle with ordered steps, correct roles/order.
  - Repeated role in a cycle → two separately numbered steps.
  - `cycle.error` → cycle `status: "error"`.
  - Events before the first `cycle.start` → land in the `cycle: null` bucket.
  - Open cycle / open step (no `cycle.completed` / no `agent.exit`) →
    `status: "running"`.
  - `input`/`output`/`summary` derived correctly from prompt + text events.

DOM rendering is verified manually in the monitor; the segmentation logic that
could regress is covered by the pure-function tests.

## Out of scope

- Single-lane console (`app.js`) — unchanged.
- Persisting `viewMode` across reloads.
- Cross-cycle comparison / diffing of the same agent between cycles.
- Truncating or paginating very long prompts/outputs beyond the summary line
  (full text shown on expand).
