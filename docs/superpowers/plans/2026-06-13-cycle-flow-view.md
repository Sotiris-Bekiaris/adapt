# Cycle-Grouped Flow View ("Cycles" tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Cycles" view to the multi-lane monitor's focused-lane pane that groups events by orchestration cycle and shows each cycle's agents as an ordered pipeline with expandable INPUT (real prompt) / OUTPUT per step.

**Architecture:** One small engine change logs each agent's prompt onto its `agent.start` event so it reaches the console stream. A pure browser module (`cycles.js`) segments a flat `ConsoleEvent[]` into cycles → steps and is unit-tested with vitest. `monitor.js`/`monitor.html` gain a `[ Stream | Cycles ]` toggle; the existing columns + timeline rendering is preserved unchanged as "Stream", and the new accordion ("Cycles") is the default view.

**Tech Stack:** TypeScript (Node engine), plain ES-module browser JS (no bundler — served statically), vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-cycle-flow-view-design.md`

---

## File Structure

- **Modify** `src/engine/claudeCode.ts` — emit `data: { prompt }` on `agent.start`.
- **Modify** `src/engine/stubEngine.ts` — same, for the default (non-scripted) event list.
- **Create** `src/observability/public/cycles.js` — pure `buildCycles(events)` segmentation. No DOM.
- **Modify** `src/observability/public/monitor.html` — view toggle, `#cycles` container, styles.
- **Modify** `src/observability/public/monitor.js` — `viewMode`, toggle wiring, cycle source (`laneEvents`), `renderCycles()`, live update, expand persistence. Made an ES module to import `cycles.js`.
- **Create** `test/observability/cycles.test.ts` — unit tests for `buildCycles`.
- **Modify** `test/engine/stubEngine.test.ts` — assert the prompt is on `agent.start`.
- **Create** `test/engine/claudeCodePrompt.test.ts` — assert `claudeCode` emits the prompt on `agent.start` (via a fake child process), OR an equivalent narrower test (see Task 1).

No server change: `monitorServer.ts` already serves any `public/*.js` with the right MIME, and `focus` already returns the full per-lane NDJSON history (both `agent` and `orchestrator` channels).

---

## Task 1: Log the agent prompt on `agent.start` (engine)

**Files:**
- Modify: `src/engine/stubEngine.ts:20-26`
- Modify: `src/engine/claudeCode.ts:85`
- Test: `test/engine/stubEngine.test.ts`

The console pipeline (`fromAgentEvent` in `src/observability/events.ts`) already forwards an event's `data` field onto `ConsoleEvent`, so adding `data` to `agent.start` is all that's needed for the prompt to flow to the NDJSON log and the live WS stream.

- [ ] **Step 1: Write the failing test**

Add to `test/engine/stubEngine.test.ts` inside the existing `describe("StubEngine", ...)` block:

```ts
  it("emits the prompt as data on agent.start", async () => {
    const engine = new StubEngine({ now: () => "2026-06-13T10:00:00.000Z" });
    let startData: unknown = undefined;
    await engine.run({ role: "critic", prompt: "review this patch", cwd: "/repo" }, (e) => {
      if (e.kind === "agent.start") startData = e.data;
    });
    expect(startData).toEqual({ prompt: "review this patch" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine/stubEngine.test.ts`
Expected: FAIL — `startData` is `undefined`, `expected undefined to deeply equal { prompt: 'review this patch' }`.

- [ ] **Step 3: Implement in the stub engine**

In `src/engine/stubEngine.ts`, the default event list currently starts with:

```ts
          { kind: "agent.start", role: spec.role, at: this.now() },
```

Change that line to:

```ts
          { kind: "agent.start", role: spec.role, at: this.now(), data: { prompt: spec.prompt } },
```

- [ ] **Step 4: Implement in the real engine**

In `src/engine/claudeCode.ts`, the line (~85):

```ts
      handle({ kind: "agent.start", role: spec.role, at: this.now() });
```

Change to:

```ts
      handle({ kind: "agent.start", role: spec.role, at: this.now(), data: { prompt: spec.prompt } });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/engine/stubEngine.test.ts`
Expected: PASS (all StubEngine tests, including the new one).

- [ ] **Step 6: Guard the real engine too**

`claudeCode.ts` spawns a real child process and is awkward to unit-test. The `AgentEvent.data` field is typed `unknown`, so the stub test already proves the field shape the console relies on. To pin the real engine, add a focused assertion using its existing test file. First inspect `test/engine/claudeCode.test.ts` to see how it fakes the child process / `spawn`, then add a test in the SAME style as the existing tests there:

```ts
  it("includes the prompt on the agent.start event", async () => {
    // Arrange the engine exactly as the existing claudeCode tests do (same fake spawn / now).
    // Collect events, then:
    const start = events.find((e) => e.kind === "agent.start");
    expect(start?.data).toEqual({ prompt: spec.prompt });
  });
```

If `claudeCode.test.ts` has no existing harness to spawn a fake process, SKIP adding a real-engine test (the one-line change mirrors the stub exactly and the stub test covers the contract). Do not invent a new spawn-mocking harness for this — that is out of scope.

- [ ] **Step 7: Run the full engine suite**

Run: `npx vitest run test/engine`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/engine/stubEngine.ts src/engine/claudeCode.ts test/engine
git commit -m "feat(engine): log agent prompt on agent.start event"
```

---

## Task 2: `buildCycles` segmentation module + tests

**Files:**
- Create: `src/observability/public/cycles.js`
- Test: `test/observability/cycles.test.ts`

`buildCycles` takes a chronological `ConsoleEvent[]` and returns `Cycle[]`. It is pure (no DOM, no globals) so it runs under vitest's node environment. The browser loads it as an ES module; vitest imports the same `.js` file directly.

Shapes (documented in a comment at the top of the file):

```
Cycle = { cycle: number|null, status: "running"|"done"|"error", startedAt: string|null, steps: Step[] }
Step  = { index: number, role: string, status: "running"|"done"|"error",
          input: string|null, output: string, summary: string, events: ConsoleEvent[] }
```

- [ ] **Step 1: Write the failing tests**

Create `test/observability/cycles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCycles } from "../../src/observability/public/cycles.js";

// Minimal ConsoleEvent factories.
const cycleStart = (n: number, at = "2026-06-13T10:00:0" + n + ".000Z") =>
  ({ channel: "orchestrator", role: "orchestrator", kind: "cycle.start", at, data: { cycle: n } });
const cycleDone = (n: number) =>
  ({ channel: "orchestrator", role: "orchestrator", kind: "cycle.completed", at: "t", data: { cycle: n } });
const cycleErr = (n: number) =>
  ({ channel: "orchestrator", role: "orchestrator", kind: "cycle.error", at: "t", data: { cycle: n, message: "boom" } });
const aStart = (role: string, prompt: string) =>
  ({ channel: "agent", role, kind: "agent.start", at: "t", data: { prompt } });
const aText = (role: string, text: string) =>
  ({ channel: "agent", role, kind: "agent.text", at: "t", text });
const aErr = (role: string) =>
  ({ channel: "agent", role, kind: "agent.error", at: "t", text: "err" });
const aExit = (role: string) =>
  ({ channel: "agent", role, kind: "agent.exit", at: "t", exitCode: 0 });

describe("buildCycles", () => {
  it("groups a multi-agent cycle into ordered steps", () => {
    const cycles = buildCycles([
      cycleStart(1),
      aStart("dreamer", "dream"), aText("dreamer", "idea: cache"), aExit("dreamer"),
      aStart("generator", "gen"), aText("generator", "patch +42 -3"), aExit("generator"),
      cycleDone(1),
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toBe(1);
    expect(cycles[0].status).toBe("done");
    expect(cycles[0].steps.map((s) => s.role)).toEqual(["dreamer", "generator"]);
    expect(cycles[0].steps.map((s) => s.index)).toEqual([1, 2]);
  });

  it("captures input prompt, output, and summary per step", () => {
    const [c] = buildCycles([
      cycleStart(1),
      aStart("critic", "review this patch"),
      aText("critic", "looks risky"),
      aText("critic", "REJECT: no tests"),
      aExit("critic"),
      cycleDone(1),
    ]);
    const step = c.steps[0];
    expect(step.input).toBe("review this patch");
    expect(step.output).toBe("looks riskyREJECT: no tests");
    expect(step.summary).toBe("REJECT: no tests");
  });

  it("treats a repeated role as separate numbered steps", () => {
    const [c] = buildCycles([
      cycleStart(1),
      aStart("critic", "p1"), aExit("critic"),
      aStart("critic", "p2"), aExit("critic"),
      cycleDone(1),
    ]);
    expect(c.steps).toHaveLength(2);
    expect(c.steps.map((s) => s.index)).toEqual([1, 2]);
    expect(c.steps.map((s) => s.input)).toEqual(["p1", "p2"]);
  });

  it("marks a cycle that errored", () => {
    const [c] = buildCycles([cycleStart(1), aStart("dreamer", "x"), aExit("dreamer"), cycleErr(1)]);
    expect(c.status).toBe("error");
  });

  it("marks a step that errored", () => {
    const [c] = buildCycles([
      cycleStart(1), aStart("dreamer", "x"), aErr("dreamer"), aExit("dreamer"), cycleDone(1),
    ]);
    expect(c.steps[0].status).toBe("error");
  });

  it("leaves an unfinished cycle and step as running", () => {
    const [c] = buildCycles([cycleStart(2), aStart("dreamer", "x"), aText("dreamer", "thinking")]);
    expect(c.status).toBe("running");
    expect(c.steps[0].status).toBe("running");
  });

  it("puts events before the first cycle.start in a pre-cycle bucket", () => {
    const cycles = buildCycles([
      aStart("demo", "p"), aText("demo", "hi"), aExit("demo"),
      cycleStart(1), aStart("dreamer", "x"), aExit("dreamer"), cycleDone(1),
    ]);
    expect(cycles).toHaveLength(2);
    expect(cycles[0].cycle).toBe(null);
    expect(cycles[0].steps[0].role).toBe("demo");
    expect(cycles[1].cycle).toBe(1);
  });

  it("falls back to the terminal event kind when a step has no text", () => {
    const [c] = buildCycles([cycleStart(1), aStart("scout", "x"), aExit("scout"), cycleDone(1)]);
    expect(c.steps[0].summary).toBe("agent.exit");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/observability/cycles.test.ts`
Expected: FAIL — `Cannot find module '.../cycles.js'` (the module does not exist yet).

- [ ] **Step 3: Implement `buildCycles`**

Create `src/observability/public/cycles.js`:

```js
// Pure cycle/step segmentation for the monitor's "Cycles" view.
// Input: chronological ConsoleEvent[]. Output: Cycle[].
//
// Cycle = { cycle: number|null, status, startedAt: string|null, steps: Step[] }
// Step  = { index, role, status, input: string|null, output: string, summary: string, events: [] }
// status is "running" | "done" | "error".
//
// No DOM, no globals — safe to import in vitest and in the browser as a module.

const SUMMARY_MAX = 80;

function summarize(text) {
  const s = (text ?? "").trim().replace(/\s+/g, " ");
  if (s.length <= SUMMARY_MAX) return s;
  return s.slice(0, SUMMARY_MAX - 1) + "…";
}

export function buildCycles(events) {
  const cycles = [];
  let current = null; // open/last cycle
  let step = null; // open step

  const ensureCycle = () => {
    if (current) return current;
    current = { cycle: null, status: "running", startedAt: null, steps: [] };
    cycles.push(current);
    return current;
  };

  const closeStep = (status) => {
    if (!step) return;
    if (status) step.status = status;
    step = null;
  };

  for (const e of events ?? []) {
    const isOrch = e.channel === "orchestrator";

    if (isOrch && e.kind === "cycle.start") {
      closeStep();
      const n = e.data && typeof e.data.cycle === "number" ? e.data.cycle : null;
      current = { cycle: n, status: "running", startedAt: e.at ?? null, steps: [] };
      cycles.push(current);
      continue;
    }

    if (isOrch && (e.kind === "cycle.completed" || e.kind === "cycle.error")) {
      if (current) current.status = e.kind === "cycle.error" ? "error" : "done";
      closeStep();
      continue;
    }

    if (e.kind === "agent.start") {
      const c = ensureCycle();
      closeStep();
      step = {
        index: c.steps.length + 1,
        role: e.role,
        status: "running",
        input: e.data && typeof e.data.prompt === "string" ? e.data.prompt : null,
        output: "",
        summary: "",
        events: [e],
      };
      c.steps.push(step);
      continue;
    }

    // Any other event attaches to the open step, if there is one.
    ensureCycle();
    if (!step) continue;
    step.events.push(e);
    if (e.kind === "agent.text" && e.text) {
      step.output += e.text;
      step.summary = summarize(e.text);
    }
    if (e.kind === "agent.error") step.status = "error";
    if (e.kind === "agent.exit") closeStep(step.status === "error" ? "error" : "done");
  }

  // Summary fallback: terminal event kind when a step produced no text.
  for (const c of cycles) {
    for (const s of c.steps) {
      if (!s.summary) {
        const last = s.events[s.events.length - 1];
        s.summary = last ? last.kind : "";
      }
    }
  }

  return cycles;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/observability/cycles.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/observability/public/cycles.js test/observability/cycles.test.ts
git commit -m "feat(monitor): pure buildCycles cycle/step segmentation"
```

---

## Task 3: Monitor markup + styles (toggle, cycles container)

**Files:**
- Modify: `src/observability/public/monitor.html`

This task only adds DOM and CSS. It does not wire behavior (Task 4). After this task the page still works in "Stream" mode because the new container is empty and the toggle is inert until Task 4.

- [ ] **Step 1: Add the view-toggle bar and cycles container**

In `src/observability/public/monitor.html`, replace the `.focus-main` block:

```html
      <div class="focus-main">
        <div id="focus-header"><span class="fh-empty">no lane focused</span></div>
        <div class="focus-body">
          <section id="agents" class="agents"></section>
          <aside id="timeline" class="timeline">
            <h2>decision timeline</h2>
            <ol id="timeline-list"></ol>
          </aside>
        </div>
      </div>
```

with:

```html
      <div class="focus-main">
        <div id="focus-header"><span class="fh-empty">no lane focused</span></div>
        <div id="view-toggle">
          <button type="button" data-view="cycles" class="active">Cycles</button>
          <button type="button" data-view="stream">Stream</button>
        </div>
        <div class="focus-body">
          <section id="cycles" class="cycles"></section>
          <section id="agents" class="agents"></section>
          <aside id="timeline" class="timeline">
            <h2>decision timeline</h2>
            <ol id="timeline-list"></ol>
          </aside>
        </div>
      </div>
```

- [ ] **Step 2: Make the module load as an ES module**

In the same file, change:

```html
    <script src="/monitor.js"></script>
```

to:

```html
    <script type="module" src="/monitor.js"></script>
```

- [ ] **Step 3: Add styles**

In `src/observability/public/monitor.html`, inside the existing `<style>` block (before its closing `</style>`), append:

```css
      #view-toggle {
        display: flex;
        gap: .3rem;
        padding: .35rem .8rem;
        background: #0d1018;
        border-bottom: 1px solid #1f2430;
      }
      #view-toggle button {
        font: inherit;
        font-size: 11px;
        letter-spacing: .04em;
        text-transform: uppercase;
        color: #6c7086;
        background: transparent;
        border: 1px solid #1f2430;
        border-radius: 4px;
        padding: .15rem .6rem;
        cursor: pointer;
      }
      #view-toggle button.active { color: #cdd6f4; border-color: #89b4fa; background: #1b2230; }
      #cycles { flex: 1; min-width: 0; overflow-y: auto; padding: .5rem .8rem; display: none; }
      .focus-body.cycles-mode { display: block; }
      .focus-body.cycles-mode #agents,
      .focus-body.cycles-mode #timeline { display: none; }
      .focus-body.cycles-mode #cycles { display: block; }
      .cycle { border: 1px solid #1f2430; border-radius: 6px; margin-bottom: .5rem; background: #0d1018; }
      .cycle-h { display: flex; align-items: center; gap: .5rem; padding: .45rem .6rem; cursor: pointer; font-size: 12px; }
      .cycle-h:hover { background: #11151f; }
      .cycle-h .caret { color: #6c7086; width: 1ch; }
      .cycle-h .cycle-title { color: #cdd6f4; font-weight: 600; }
      .cycle-h .dot.running { color: #a6e3a1; }
      .cycle-h .dot.done { color: #89b4fa; }
      .cycle-h .dot.error { color: #f38ba8; }
      .cycle-h .cycle-meta { color: #6c7086; margin-left: auto; }
      .cycle-body { padding: .2rem .5rem .5rem; }
      .step { border-top: 1px dotted #1b2230; }
      .step-h { display: flex; align-items: center; gap: .5rem; padding: .35rem .3rem; cursor: pointer; font-size: 12px; }
      .step-h:hover { background: #11151f; }
      .step-idx { color: #6c7086; }
      .step-role { color: #cba6f7; font-weight: 600; }
      .step-status { font-size: 11px; }
      .step-status.running { color: #a6e3a1; }
      .step-status.done { color: #6c7086; }
      .step-status.error { color: #f38ba8; }
      .step-sum { color: #bac2de; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .step-detail { padding: .2rem .3rem .5rem; display: flex; flex-direction: column; gap: .4rem; }
      .io-block { border: 1px solid #1f2430; border-radius: 4px; }
      .io-label { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #6c7086; padding: .25rem .5rem; border-bottom: 1px solid #1f2430; }
      .io-text { margin: 0; padding: .4rem .5rem; font-size: 12px; color: #cdd6f4; white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow-y: auto; }
```

- [ ] **Step 4: Commit**

```bash
git add src/observability/public/monitor.html
git commit -m "feat(monitor): cycles view markup + styles (inert)"
```

---

## Task 4: Wire the Cycles view in `monitor.js`

**Files:**
- Modify: `src/observability/public/monitor.js`

This task makes the toggle work, builds the cycle model from each lane's full event history (the `focus` → `history` payload, plus live appends), renders the accordion, and keeps it live. The existing Stream rendering (`column`/`render`/timeline) is left intact and continues to receive events so it stays warm behind the toggle.

There is no DOM unit-test harness in this repo, so this task is verified by the full suite (no regressions) plus the manual check in Task 5.

- [ ] **Step 1: Import the segmentation module and add element refs + state**

At the very top of `src/observability/public/monitor.js`, add the import as the first line:

```js
import { buildCycles } from "/cycles.js";
```

Then, alongside the existing element refs near the top, add:

```js
const focusMainQuery = () => document.querySelector(".focus-body");
const cyclesEl = document.getElementById("cycles");
const toggleEl = document.getElementById("view-toggle");
const timelineAsideEl = document.getElementById("timeline");
```

And alongside the existing module-level state (`focusedLane`, `lanes`, `buffers`, `columns`), add:

```js
let viewMode = "cycles"; // "stream" | "cycles"
const laneEvents = new Map(); // laneId -> full ConsoleEvent[] (history + live), source for buildCycles
const expanded = new Set(); // expand keys: cycle "c:<n>" and step "s:<n>:<idx>"
const seenCycleKeys = new Set(); // cycles whose default-open has been applied
```

- [ ] **Step 2: Add the cycle-rendering functions**

Add these functions to `monitor.js` (place them after `clearPane()` and before the `--- sidebar ---` section):

```js
// --- cycles view ---

function cycleKey(c) {
  return "c:" + (c.cycle === null ? "pre" : c.cycle);
}
function stepKey(c, s) {
  return "s:" + (c.cycle === null ? "pre" : c.cycle) + ":" + s.index;
}

function isCycleOpen(c, isNewest) {
  const key = cycleKey(c);
  if (!seenCycleKeys.has(key)) {
    seenCycleKeys.add(key);
    if (isNewest || c.status === "running") expanded.add(key);
  }
  return expanded.has(key);
}

function ioBlock(label, text) {
  const block = document.createElement("div");
  block.className = "io-block";
  const h = document.createElement("div");
  h.className = "io-label";
  h.textContent = label;
  const pre = document.createElement("pre");
  pre.className = "io-text";
  pre.textContent = text;
  block.append(h, pre);
  return block;
}

function renderStep(c, s) {
  const row = document.createElement("div");
  row.className = "step " + s.status;

  const head = document.createElement("div");
  head.className = "step-h";
  const idx = document.createElement("span");
  idx.className = "step-idx";
  idx.textContent = "#" + s.index;
  const role = document.createElement("span");
  role.className = "step-role";
  role.textContent = s.role;
  const status = document.createElement("span");
  status.className = "step-status " + s.status;
  status.textContent = s.status;
  const sum = document.createElement("span");
  sum.className = "step-sum";
  sum.textContent = s.summary;
  head.append(idx, role, status, sum);

  const key = stepKey(c, s);
  head.addEventListener("click", () => {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    renderCycles();
  });
  row.append(head);

  if (expanded.has(key)) {
    const detail = document.createElement("div");
    detail.className = "step-detail";
    const prev = s.index > 1 ? c.steps[s.index - 2] : null;
    const inLabel = prev ? `INPUT (from #${prev.index} ${prev.role})` : "INPUT (cycle seed)";
    detail.append(
      ioBlock(inLabel, s.input ?? "(no prompt logged)"),
      ioBlock("OUTPUT", s.output || "(no output)"),
    );
    row.append(detail);
  }
  return row;
}

function renderCycle(c, isNewest) {
  const wrap = document.createElement("div");
  wrap.className = "cycle " + c.status;
  const open = isCycleOpen(c, isNewest);

  const header = document.createElement("div");
  header.className = "cycle-h";
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = open ? "▼" : "▶";
  const title = document.createElement("span");
  title.className = "cycle-title";
  title.textContent = c.cycle === null ? "pre-cycle" : "Cycle " + c.cycle;
  const dot = document.createElement("span");
  dot.className = "dot " + c.status;
  dot.textContent = c.status === "error" ? "✗" : "●";
  const meta = document.createElement("span");
  meta.className = "cycle-meta";
  const time = (c.startedAt || "").slice(11, 19);
  const n = c.steps.length;
  meta.textContent = `${time ? time + " · " : ""}${n} step${n === 1 ? "" : "s"}`;
  header.append(caret, title, dot, meta);
  header.addEventListener("click", () => {
    const key = cycleKey(c);
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    renderCycles();
  });
  wrap.append(header);

  if (open) {
    const body = document.createElement("div");
    body.className = "cycle-body";
    for (const s of c.steps) body.append(renderStep(c, s));
    wrap.append(body);
  }
  return wrap;
}

function renderCycles() {
  cyclesEl.replaceChildren();
  if (!focusedLane) return;
  const cycles = buildCycles(laneEvents.get(focusedLane) || []);
  for (let i = cycles.length - 1; i >= 0; i--) {
    cyclesEl.append(renderCycle(cycles[i], i === cycles.length - 1));
  }
}

function setView(mode) {
  viewMode = mode;
  for (const b of toggleEl.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.view === mode);
  }
  const body = focusMainQuery();
  if (body) body.classList.toggle("cycles-mode", mode === "cycles");
  if (mode === "cycles") renderCycles();
}

toggleEl.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-view]");
  if (btn) setView(btn.dataset.view);
});
```

- [ ] **Step 3: Track full per-lane events for the cycle source**

In `monitor.js`, the `handleMessage` function currently handles `event` and `history`. Update both branches so `laneEvents` stays the authoritative full list, and the cycles view refreshes live.

Replace the `event` branch:

```js
  if (msg.type === "event") {
    bufferEvent(msg.lane, msg.event);
    if (msg.lane === focusedLane) render(msg.event);
    return;
  }
```

with:

```js
  if (msg.type === "event") {
    bufferEvent(msg.lane, msg.event);
    appendLaneEvent(msg.lane, msg.event);
    if (msg.lane === focusedLane) {
      render(msg.event);
      if (viewMode === "cycles") renderCycles();
    }
    return;
  }
```

Replace the `history` branch:

```js
  if (msg.type === "history") {
    if (msg.lane === focusedLane && Array.isArray(msg.events)) {
      for (const e of msg.events) render(e);
    }
    return;
  }
```

with:

```js
  if (msg.type === "history") {
    if (Array.isArray(msg.events)) laneEvents.set(msg.lane, msg.events.slice());
    if (msg.lane === focusedLane) {
      for (const e of msg.events || []) render(e);
      if (viewMode === "cycles") renderCycles();
    }
    return;
  }
```

Then add the `appendLaneEvent` helper next to the existing `bufferEvent` function:

```js
function appendLaneEvent(laneId, event) {
  let list = laneEvents.get(laneId);
  if (!list) {
    list = [];
    laneEvents.set(laneId, list);
  }
  list.push(event);
}
```

- [ ] **Step 4: Reset cycle state on focus change and apply the default view**

In `monitor.js`, the `focusLane` function clears the Stream pane and requests history. Update it so the cycle expand-state resets per lane and the current `viewMode` is applied. Change `focusLane`:

```js
function focusLane(laneId) {
  focusedLane = laneId;
  clearPane();
  renderSidebar();
  renderFocusHeader();

  const meta = laneMeta(laneId);
  if (meta && meta.status === "running") {
    // replay buffered live events for instant context
    const buf = buffers.get(laneId);
    if (buf) for (const e of buf) render(e);
  }
  // ask server for what it has (history for stopped lanes; harmless otherwise)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "focus", lane: laneId }));
  }
}
```

to:

```js
function focusLane(laneId) {
  focusedLane = laneId;
  clearPane();
  expanded.clear();
  seenCycleKeys.clear();
  renderSidebar();
  renderFocusHeader();
  setView(viewMode);

  const meta = laneMeta(laneId);
  if (meta && meta.status === "running") {
    // replay buffered live events for instant context
    const buf = buffers.get(laneId);
    if (buf) for (const e of buf) render(e);
  }
  // ask server for what it has (full history; drives the cycles view)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "focus", lane: laneId }));
  }
}
```

(`clearPane()` already empties `#agents` and the timeline; `#cycles` is rebuilt by `renderCycles()`. No change needed in `clearPane`.)

- [ ] **Step 5: Type-check and run the full suite (no regressions)**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors; the `.js` client files are not type-checked but should not break the build).

Run: `npx vitest run`
Expected: PASS — all existing tests plus Tasks 1–2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/observability/public/monitor.js
git commit -m "feat(monitor): wire Cycles view (toggle, accordion, live update)"
```

---

## Task 5: Manual verification

**Files:** none (runtime check).

- [ ] **Step 1: Launch the monitor against a target with lane activity**

Run the monitor CLI command (see `src/cli/commands/monitor.ts` for exact flags; typically):

```bash
npx adapt monitor --repo <target-with-lanes> --port 0
```

Open the printed `http://127.0.0.1:<port>` URL.

- [ ] **Step 2: Verify the Cycles view**

Confirm:
- The focused lane defaults to the **Cycles** tab; `[ Stream | Cycles ]` toggle switches between the accordion and the old columns+timeline.
- Cycles are listed newest-first; the newest / running cycle is auto-expanded.
- Each cycle shows ordered steps (`#1 dreamer`, `#2 generator`, …) with a one-line summary and a status.
- Clicking a step reveals INPUT (the agent's real prompt, labeled `from #N <role>` or `cycle seed`) and OUTPUT.
- A running lane updates the running cycle live without collapsing already-expanded cycles/steps.
- Switching focus between lanes resets expansion and shows that lane's own cycles.

If the accordion is empty for an active lane, confirm `cycle.start` events are present in the **Stream** view — the cycle grouping depends on the orchestrator's `cycle.start` / `cycle.completed` events being in the lane's decision log. If they are absent, that is a data-availability gap to raise, not a bug in this view.

- [ ] **Step 3: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "chore(monitor): cycles view manual-test fixes"
```

(Skip if Step 2 passed with no changes.)

---

## Self-Review Notes

- **Spec coverage:** prompt capture → Task 1; `buildCycles` model (cycle/step segmentation, pre-cycle bucket, repeated role, statuses, input/output/summary) → Task 2; toggle + accordion + INPUT/OUTPUT + default Cycles + textContent-only + live update → Tasks 3–4; monitor-only scope, `app.js` untouched → respected (not modified). ✓
- **Types/names consistency:** `buildCycles`, `Cycle`/`Step` field names (`cycle`, `status`, `startedAt`, `steps`, `index`, `role`, `input`, `output`, `summary`, `events`) used identically across Tasks 2 and 4. Expand-key helpers `cycleKey`/`stepKey` and state sets `expanded`/`seenCycleKeys`/`laneEvents` consistent across steps. ✓
- **Security:** all rendered fields use `textContent` / `<pre>.textContent`; no `innerHTML`. ✓
