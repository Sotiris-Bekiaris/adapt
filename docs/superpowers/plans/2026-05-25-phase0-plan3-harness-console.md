# Phase 0 · Plan 3 — Agent Harness, Streaming & Web Console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch a coding-agent engine (Claude Code headless) as a subprocess, capture its streaming output as structured events, normalize those plus orchestrator events onto one bus, persist them to an append-only decision log, and fan them to a live web dashboard over websockets — "mission control" for the organism.

**Architecture:** An `AgentEngine` interface with two implementations — `StubEngine` (deterministic, for tests + demos) and `ClaudeCodeEngine` (spawns `claude -p … --output-format stream-json`, parsing NDJSON via a pure `parseStreamLine`). A generic `EventBus` carries normalized `ConsoleEvent`s; engine events and Plan 2 orchestrator events both map onto it. The `DecisionLog` appends every event as NDJSON (blueprint §11 — the primary deliverable). The `ObservabilityServer` (Node `http` + `ws`) serves a vanilla-JS dashboard and streams events with a replay backlog. The Claude spawn is tested with a substitute command, so no `claude` binary or network is needed in CI.

**Tech Stack:** Builds on Plans 1–2. Adds `ws` + `@types/ws`. Node + TS + Vitest.

**Depends on:** Plan 1 (`workspacePaths`), Plan 2 (`OrchestratorEvent`).

---

## File Structure

```
src/engine/
  types.ts             # AgentEngine, AgentEvent, AgentSpec, AgentResult
  parseStream.ts       # pure: parseStreamLine(line) -> AgentEvent[]
  stubEngine.ts        # deterministic engine for tests + demos
  claudeCode.ts        # spawn claude headless, parse stream-json
  runAgent.ts          # run an engine + forward events to a sink
src/observability/
  events.ts            # ConsoleEvent + mappers from agent/orchestrator events
  eventBus.ts          # generic subscribe/publish bus
  decisionLog.ts       # append-only NDJSON log in .adapt/decision-log
  server.ts            # http + ws server, static dashboard, replay backlog
  console.ts           # demoConsole(): start server + run a stub agent (for `adapt console`)
  public/
    index.html
    app.js
    styles.css
src/cli/commands/console.ts   # `adapt console` command core
test/engine/*.test.ts
test/observability/*.test.ts
test/cli/console.test.ts
```

---

## Task 0: Add websocket dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install ws + types**

Run: `npm install ws@^8.18.0 && npm install -D @types/ws@^8.5.13`
Expected: installs cleanly.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ws for the live console"
```

---

## Task 1: Engine types + stub engine

**Files:**
- Create: `src/engine/types.ts`, `src/engine/stubEngine.ts`
- Test: `test/engine/stubEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { StubEngine } from "../../src/engine/stubEngine.ts";

describe("StubEngine", () => {
  it("streams start -> text -> exit and resolves with finalText", async () => {
    const engine = new StubEngine({ now: () => "2026-05-25T10:00:00.000Z" });
    const seen: string[] = [];
    const result = await engine.run(
      { role: "runner", prompt: "say hello", cwd: "/repo" },
      (e) => seen.push(e.kind),
    );
    expect(seen[0]).toBe("agent.start");
    expect(seen.at(-1)).toBe("agent.exit");
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toContain("say hello");
    expect(result.role).toBe("runner");
  });

  it("can be scripted with explicit events", async () => {
    const engine = new StubEngine({
      now: () => "t",
      script: () => [{ kind: "agent.text", role: "x", at: "t", text: "scripted" }],
    });
    const r = await engine.run({ role: "x", prompt: "p", cwd: "/" }, () => {});
    expect(r.finalText).toBe("scripted");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine/stubEngine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementations**

`src/engine/types.ts`:

```ts
export type AgentEventKind =
  | "agent.start"
  | "agent.thinking"
  | "agent.tool_call"
  | "agent.tool_result"
  | "agent.text"
  | "agent.error"
  | "agent.exit";

export interface AgentEvent {
  kind: AgentEventKind;
  role: string;          // logical role: runner, triage, implementation, verification, ...
  at: string;            // ISO timestamp
  text?: string;         // for thinking / text / error
  tool?: string;         // tool name for tool_call / tool_result
  data?: unknown;        // raw payload
  exitCode?: number;     // for agent.exit
}

export interface AgentSpec {
  role: string;
  prompt: string;
  cwd: string;                       // working directory (the target repo)
  mcpServers?: string[];             // MCP server names to expose (wired by the engine)
  env?: Record<string, string>;
}

export interface AgentResult {
  role: string;
  exitCode: number;
  events: AgentEvent[];
  finalText: string;
}

export interface AgentEngine {
  run(spec: AgentSpec, onEvent: (e: AgentEvent) => void): Promise<AgentResult>;
}
```

`src/engine/stubEngine.ts`:

```ts
import type { AgentEngine, AgentEvent, AgentResult, AgentSpec } from "./types.ts";

export interface StubEngineOptions {
  now?: () => string;
  script?: (spec: AgentSpec) => AgentEvent[];
}

/** Deterministic engine. Default script echoes the prompt; useful for tests and the demo console. */
export class StubEngine implements AgentEngine {
  private now: () => string;
  private script?: (spec: AgentSpec) => AgentEvent[];

  constructor(opts: StubEngineOptions = {}) {
    this.now = opts.now ?? (() => new Date().toISOString());
    this.script = opts.script;
  }

  async run(spec: AgentSpec, onEvent: (e: AgentEvent) => void): Promise<AgentResult> {
    const events: AgentEvent[] = this.script
      ? this.script(spec)
      : [
          { kind: "agent.start", role: spec.role, at: this.now() },
          { kind: "agent.text", role: spec.role, at: this.now(), text: `(stub) ${spec.prompt}` },
          { kind: "agent.exit", role: spec.role, at: this.now(), exitCode: 0 },
        ];

    let finalText = "";
    for (const e of events) {
      if (e.kind === "agent.text") finalText += e.text ?? "";
      onEvent(e);
    }
    const exit = events.find((e) => e.kind === "agent.exit");
    return { role: spec.role, exitCode: exit?.exitCode ?? 0, events, finalText };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/engine/stubEngine.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/stubEngine.ts test/engine/stubEngine.test.ts
git commit -m "feat(engine): AgentEngine interface + deterministic StubEngine"
```

---

## Task 2: Claude stream-json parser (pure)

**Files:**
- Create: `src/engine/parseStream.ts`
- Test: `test/engine/parseStream.test.ts`

`claude --output-format stream-json` emits one JSON object per line. We translate each into zero or more `AgentEvent`s. Pure and fully unit-testable.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseStreamLine } from "../../src/engine/parseStream.ts";

const now = () => "t";

describe("parseStreamLine", () => {
  it("maps an assistant text block to agent.text", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } });
    const ev = parseStreamLine(line, "runner", now);
    expect(ev).toEqual([{ kind: "agent.text", role: "runner", at: "t", text: "hello" }]);
  });

  it("maps a tool_use block to agent.tool_call with the tool name", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } });
    const ev = parseStreamLine(line, "impl", now);
    expect(ev[0]!.kind).toBe("agent.tool_call");
    expect(ev[0]!.tool).toBe("Bash");
  });

  it("maps a thinking block to agent.thinking", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "hmm" }] } });
    expect(parseStreamLine(line, "r", now)[0]!.kind).toBe("agent.thinking");
  });

  it("maps a user tool_result to agent.tool_result", () => {
    const line = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "done" }] } });
    expect(parseStreamLine(line, "r", now)[0]!.kind).toBe("agent.tool_result");
  });

  it("ignores system and result lines (engine emits start/exit itself)", () => {
    expect(parseStreamLine(JSON.stringify({ type: "system", subtype: "init" }), "r", now)).toEqual([]);
    expect(parseStreamLine(JSON.stringify({ type: "result", subtype: "success", result: "x" }), "r", now)).toEqual([]);
  });

  it("returns [] for blank lines and surfaces non-JSON as text", () => {
    expect(parseStreamLine("   ", "r", now)).toEqual([]);
    expect(parseStreamLine("plain output", "r", now)).toEqual([{ kind: "agent.text", role: "r", at: "t", text: "plain output" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine/parseStream.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { AgentEvent } from "./types.ts";

/** Translate one stream-json line into AgentEvents. system/result -> []; non-JSON -> a text event. */
export function parseStreamLine(line: string, role: string, now: () => string): AgentEvent[] {
  const trimmed = line.trim();
  if (trimmed === "") return [];

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [{ kind: "agent.text", role, at: now(), text: trimmed }];
  }

  if (obj.type === "system" || obj.type === "result") return [];

  if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
    const out: AgentEvent[] = [];
    for (const block of obj.message.content) {
      if (block.type === "text" && block.text) {
        out.push({ kind: "agent.text", role, at: now(), text: block.text });
      } else if (block.type === "thinking" && block.thinking) {
        out.push({ kind: "agent.thinking", role, at: now(), text: block.thinking });
      } else if (block.type === "tool_use") {
        out.push({ kind: "agent.tool_call", role, at: now(), tool: block.name, data: block.input });
      }
    }
    return out;
  }

  if (obj.type === "user" && Array.isArray(obj.message?.content)) {
    return obj.message.content
      .filter((b: any) => b.type === "tool_result")
      .map((b: any): AgentEvent => ({
        kind: "agent.tool_result", role, at: now(),
        text: typeof b.content === "string" ? b.content : undefined, data: b.content,
      }));
  }

  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/engine/parseStream.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/parseStream.ts test/engine/parseStream.test.ts
git commit -m "feat(engine): pure stream-json line parser"
```

---

## Task 3: Claude Code engine (subprocess + stream)

**Files:**
- Create: `src/engine/claudeCode.ts`
- Test: `test/engine/claudeCode.test.ts`

Spawns the engine binary and streams its NDJSON stdout through `parseStreamLine`. The test injects a substitute command (`node -e …`) so it exercises the real spawn/buffer/parse pipeline without needing `claude`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ClaudeCodeEngine } from "../../src/engine/claudeCode.ts";

// A fake "engine" that prints two NDJSON lines (one split across writes) then exits 0.
const fakeScript = `
const out = [
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } }),
];
process.stdout.write(out[0] + "\\n" + out[1].slice(0, 10));
setTimeout(() => { process.stdout.write(out[1].slice(10) + "\\n"); process.exit(0); }, 10);
`;

describe("ClaudeCodeEngine", () => {
  it("spawns the command, parses streamed lines, and emits start/exit", async () => {
    const engine = new ClaudeCodeEngine({
      command: "node",
      argsBuilder: () => ["-e", fakeScript],
      now: () => "t",
    });
    const kinds: string[] = [];
    const result = await engine.run({ role: "runner", prompt: "go", cwd: process.cwd() }, (e) => kinds.push(e.kind));
    expect(kinds[0]).toBe("agent.start");
    expect(kinds).toContain("agent.text");
    expect(kinds).toContain("agent.tool_call");
    expect(kinds.at(-1)).toBe("agent.exit");
    expect(result.exitCode).toBe(0);
    expect(result.finalText).toBe("hi");
  });

  it("captures a non-zero exit code", async () => {
    const engine = new ClaudeCodeEngine({ command: "node", argsBuilder: () => ["-e", "process.exit(3)"], now: () => "t" });
    const r = await engine.run({ role: "x", prompt: "p", cwd: process.cwd() }, () => {});
    expect(r.exitCode).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine/claudeCode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { spawn } from "node:child_process";
import type { AgentEngine, AgentEvent, AgentResult, AgentSpec } from "./types.ts";
import { parseStreamLine } from "./parseStream.ts";

export interface ClaudeCodeEngineOptions {
  command?: string;                              // default "claude"
  argsBuilder?: (spec: AgentSpec) => string[];   // default builds headless stream-json flags
  now?: () => string;
}

function defaultArgs(spec: AgentSpec): string[] {
  const args = ["-p", spec.prompt, "--output-format", "stream-json", "--verbose"];
  for (const s of spec.mcpServers ?? []) args.push("--mcp-config", s);
  return args;
}

export class ClaudeCodeEngine implements AgentEngine {
  private command: string;
  private argsBuilder: (spec: AgentSpec) => string[];
  private now: () => string;

  constructor(opts: ClaudeCodeEngineOptions = {}) {
    this.command = opts.command ?? "claude";
    this.argsBuilder = opts.argsBuilder ?? defaultArgs;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  run(spec: AgentSpec, onEvent: (e: AgentEvent) => void): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.argsBuilder(spec), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
      });

      const events: AgentEvent[] = [];
      let finalText = "";
      let buf = "";

      const handle = (e: AgentEvent) => {
        events.push(e);
        if (e.kind === "agent.text") finalText += e.text ?? "";
        onEvent(e);
      };

      handle({ kind: "agent.start", role: spec.role, at: this.now() });

      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          for (const ev of parseStreamLine(line, spec.role, this.now)) handle(ev);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        handle({ kind: "agent.error", role: spec.role, at: this.now(), text: chunk.toString() });
      });

      child.on("error", reject);

      child.on("close", (code) => {
        if (buf.trim() !== "") for (const ev of parseStreamLine(buf, spec.role, this.now)) handle(ev);
        handle({ kind: "agent.exit", role: spec.role, at: this.now(), exitCode: code ?? 0 });
        resolve({ role: spec.role, exitCode: code ?? 0, events, finalText });
      });
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/engine/claudeCode.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/claudeCode.ts test/engine/claudeCode.test.ts
git commit -m "feat(engine): Claude Code headless engine (spawn + stream-json)"
```

---

## Task 4: runAgent helper

**Files:**
- Create: `src/engine/runAgent.ts`
- Test: `test/engine/runAgent.test.ts`

Thin helper: run any engine and forward each event to a sink (the event bus, wired in Task 8).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runAgent } from "../../src/engine/runAgent.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";

describe("runAgent", () => {
  it("forwards every event to the sink and returns the result", async () => {
    const sink: string[] = [];
    const result = await runAgent(
      new StubEngine({ now: () => "t" }),
      { role: "runner", prompt: "hello", cwd: "/repo" },
      (e) => sink.push(e.kind),
    );
    expect(sink).toEqual(["agent.start", "agent.text", "agent.exit"]);
    expect(result.finalText).toContain("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine/runAgent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { AgentEngine, AgentEvent, AgentResult, AgentSpec } from "./types.ts";

/** Run an engine, forwarding each streamed event to `sink`. Returns the final result. */
export function runAgent(
  engine: AgentEngine,
  spec: AgentSpec,
  sink: (e: AgentEvent) => void,
): Promise<AgentResult> {
  return engine.run(spec, sink);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/engine/runAgent.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/engine/runAgent.ts test/engine/runAgent.test.ts
git commit -m "feat(engine): runAgent helper forwarding events to a sink"
```

---

## Task 5: Event bus

**Files:**
- Create: `src/observability/eventBus.ts`
- Test: `test/observability/eventBus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { EventBus } from "../../src/observability/eventBus.ts";

describe("EventBus", () => {
  it("delivers published events to subscribers", () => {
    const bus = new EventBus<{ n: number }>();
    const got: number[] = [];
    bus.subscribe((e) => got.push(e.n));
    bus.publish({ n: 1 });
    bus.publish({ n: 2 });
    expect(got).toEqual([1, 2]);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new EventBus<number>();
    const got: number[] = [];
    const off = bus.subscribe((e) => got.push(e));
    bus.publish(1);
    off();
    bus.publish(2);
    expect(got).toEqual([1]);
  });

  it("keeps a bounded recent-event buffer for replay", () => {
    const bus = new EventBus<number>({ bufferSize: 2 });
    bus.publish(1); bus.publish(2); bus.publish(3);
    expect(bus.recent()).toEqual([2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/observability/eventBus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface EventBusOptions {
  bufferSize?: number;
}

/** Minimal synchronous pub/sub with a bounded replay buffer. */
export class EventBus<T> {
  private subscribers = new Set<(e: T) => void>();
  private buffer: T[] = [];
  private bufferSize: number;

  constructor(opts: EventBusOptions = {}) {
    this.bufferSize = opts.bufferSize ?? 500;
  }

  subscribe(fn: (e: T) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(event: T): void {
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    for (const fn of this.subscribers) fn(event);
  }

  recent(): T[] {
    return [...this.buffer];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/observability/eventBus.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/observability/eventBus.ts test/observability/eventBus.test.ts
git commit -m "feat(observability): generic event bus with replay buffer"
```

---

## Task 6: ConsoleEvent normalization

**Files:**
- Create: `src/observability/events.ts`
- Test: `test/observability/events.test.ts`

One normalized shape the dashboard understands, with mappers from agent events (Task 1) and orchestrator events (Plan 2).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { fromAgentEvent, fromOrchestratorEvent } from "../../src/observability/events.ts";

describe("ConsoleEvent mappers", () => {
  it("maps an agent event onto the agent channel", () => {
    const ce = fromAgentEvent({ kind: "agent.tool_call", role: "impl", at: "t", tool: "Bash", data: { command: "ls" } });
    expect(ce).toEqual({ channel: "agent", role: "impl", kind: "agent.tool_call", at: "t", text: undefined, tool: "Bash", data: { command: "ls" } });
  });

  it("maps an orchestrator event onto the orchestrator channel", () => {
    const ce = fromOrchestratorEvent({ type: "run.created", at: "t", runId: "RUN-1", scenarioId: "SCN-001" });
    expect(ce.channel).toBe("orchestrator");
    expect(ce.role).toBe("orchestrator");
    expect(ce.kind).toBe("run.created");
    expect(ce.data).toMatchObject({ runId: "RUN-1", scenarioId: "SCN-001" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/observability/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { AgentEvent } from "../engine/types.ts";
import type { OrchestratorEvent } from "../orchestrator/orchestrator.ts";

export interface ConsoleEvent {
  channel: "agent" | "orchestrator";
  role: string;
  kind: string;
  at: string;
  text?: string;
  tool?: string;
  data?: unknown;
}

export function fromAgentEvent(e: AgentEvent): ConsoleEvent {
  return { channel: "agent", role: e.role, kind: e.kind, at: e.at, text: e.text, tool: e.tool, data: e.data };
}

export function fromOrchestratorEvent(e: OrchestratorEvent): ConsoleEvent {
  const { type, at, ...rest } = e;
  return { channel: "orchestrator", role: "orchestrator", kind: type, at, data: rest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/observability/events.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/observability/events.ts test/observability/events.test.ts
git commit -m "feat(observability): normalized ConsoleEvent + mappers"
```

---

## Task 7: Decision log

**Files:**
- Create: `src/observability/decisionLog.ts`
- Test: `test/observability/decisionLog.test.ts`

Append-only NDJSON per day in `.adapt/decision-log/` (blueprint §11 — the primary deliverable / replayable history).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { DecisionLog } from "../../src/observability/decisionLog.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("DecisionLog", () => {
  it("appends events as NDJSON and reads them back in order", () => {
    dir = makeTmpDir();
    const log = new DecisionLog(dir, () => "2026-05-25T10:00:00.000Z");
    log.append({ channel: "orchestrator", role: "orchestrator", kind: "run.created", at: "2026-05-25T10:00:00.000Z" });
    log.append({ channel: "agent", role: "runner", kind: "agent.text", at: "2026-05-25T10:00:01.000Z", text: "hi" });
    const all = log.readDay("2026-05-25");
    expect(all.length).toBe(2);
    expect(all[1]!.text).toBe("hi");
  });

  it("readDay returns [] for a day with no log", () => {
    dir = makeTmpDir();
    const log = new DecisionLog(dir, () => "2026-05-25T10:00:00.000Z");
    expect(log.readDay("2020-01-01")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/observability/decisionLog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import type { ConsoleEvent } from "./events.ts";

export class DecisionLog {
  private dir: string;
  private now: () => string;

  constructor(targetRepo: string, now: () => string = () => new Date().toISOString()) {
    this.dir = workspacePaths(targetRepo).decisionLogDir;
    this.now = now;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(day: string): string {
    return join(this.dir, `${day}.ndjson`);
  }

  append(event: ConsoleEvent): void {
    const day = (event.at ?? this.now()).slice(0, 10);
    appendFileSync(this.fileFor(day), JSON.stringify(event) + "\n", "utf8");
  }

  readDay(day: string): ConsoleEvent[] {
    const path = this.fileFor(day);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as ConsoleEvent);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/observability/decisionLog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/observability/decisionLog.ts test/observability/decisionLog.test.ts
git commit -m "feat(observability): append-only NDJSON decision log"
```

---

## Task 8: Observability server (http + ws)

**Files:**
- Create: `src/observability/server.ts`
- Test: `test/observability/server.test.ts`

Serves the dashboard and streams `ConsoleEvent`s: on connect it replays the bus buffer, then forwards live events. Listening on port 0 yields an ephemeral port for tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { EventBus } from "../../src/observability/eventBus.ts";
import { ObservabilityServer } from "../../src/observability/server.ts";
import type { ConsoleEvent } from "../../src/observability/events.ts";

let server: ObservabilityServer | undefined;
afterEach(async () => { if (server) await server.stop(); server = undefined; });

function ev(kind: string): ConsoleEvent {
  return { channel: "agent", role: "runner", kind, at: "t" };
}

describe("ObservabilityServer", () => {
  it("replays buffered events then streams live ones over ws", async () => {
    const bus = new EventBus<ConsoleEvent>();
    bus.publish(ev("buffered"));
    server = new ObservabilityServer(bus);
    const port = await server.start(0);

    const got: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    const done = new Promise<void>((resolve) => {
      ws.on("message", (raw) => {
        const e = JSON.parse(raw.toString()) as ConsoleEvent;
        got.push(e.kind);
        if (e.kind === "live") resolve();
      });
    });

    bus.publish(ev("live"));
    await done;
    ws.close();

    expect(got[0]).toBe("buffered");
    expect(got).toContain("live");
  });

  it("serves the dashboard html at /", async () => {
    const bus = new EventBus<ConsoleEvent>();
    server = new ObservabilityServer(bus);
    const port = await server.start(0);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body.toLowerCase()).toContain("<!doctype html");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/observability/server.test.ts`
Expected: FAIL — module not found (and the dashboard html does not exist yet; Task 9 adds it — this test's second case will pass once Task 9 runs. For now expect the import failure.)

- [ ] **Step 3: Write minimal implementation**

```ts
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { EventBus } from "./eventBus.ts";
import type { ConsoleEvent } from "./events.ts";

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "public");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

export class ObservabilityServer {
  private http: Server;
  private wss: WebSocketServer;
  private unsub?: () => void;

  constructor(private bus: EventBus<ConsoleEvent>) {
    this.http = createServer((req, res) => this.serveStatic(req.url ?? "/", res));
    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });
    this.wss.on("connection", (socket) => {
      for (const e of this.bus.recent()) socket.send(JSON.stringify(e));
    });
  }

  private serveStatic(url: string, res: import("node:http").ServerResponse): void {
    const rel = url === "/" ? "index.html" : url.replace(/^\//, "").split("?")[0]!;
    const file = join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }

  /** Start listening. Pass 0 for an ephemeral port. Resolves with the bound port. */
  start(port: number): Promise<number> {
    this.unsub = this.bus.subscribe((e) => {
      const payload = JSON.stringify(e);
      for (const client of this.wss.clients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    });
    return new Promise((resolve) => {
      this.http.listen(port, "127.0.0.1", () => {
        const addr = this.http.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      });
    });
  }

  stop(): Promise<void> {
    this.unsub?.();
    return new Promise((resolve) => {
      this.wss.close(() => this.http.close(() => resolve()));
    });
  }
}
```

- [ ] **Step 4: Run the ws test (html test will pass after Task 9)**

Run: `npx vitest run test/observability/server.test.ts -t "streams live"`
Expected: PASS (the replay+live streaming test).

- [ ] **Step 5: Commit**

```bash
git add src/observability/server.ts test/observability/server.test.ts
git commit -m "feat(observability): http+ws server with replay backlog and live stream"
```

---

## Task 9: Dashboard static files

**Files:**
- Create: `src/observability/public/index.html`, `src/observability/public/styles.css`, `src/observability/public/app.js`

Vanilla JS "mission control": per-role columns of streamed events plus a single chronological timeline. No build step.

- [ ] **Step 1: Create `src/observability/public/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>adapt · mission control</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header>
      <h1>adapt · mission control</h1>
      <span id="status" class="disconnected">connecting…</span>
    </header>
    <main>
      <section id="agents" class="agents"></section>
      <aside id="timeline" class="timeline">
        <h2>decision timeline</h2>
        <ol id="timeline-list"></ol>
      </aside>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/observability/public/styles.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0b0e14; color: #cdd6f4; }
header { display: flex; align-items: center; gap: 1rem; padding: .6rem 1rem; background: #11151f; border-bottom: 1px solid #1f2430; }
header h1 { font-size: 14px; margin: 0; letter-spacing: .04em; }
#status { font-size: 11px; padding: .15rem .5rem; border-radius: 999px; }
#status.connected { background: #1e3a2a; color: #a6e3a1; }
#status.disconnected { background: #3a1e22; color: #f38ba8; }
main { display: grid; grid-template-columns: 1fr 320px; height: calc(100vh - 44px); }
.agents { display: flex; gap: .5rem; padding: .5rem; overflow-x: auto; }
.agent-col { min-width: 260px; flex: 1; background: #11151f; border: 1px solid #1f2430; border-radius: 8px; display: flex; flex-direction: column; }
.agent-col h3 { margin: 0; padding: .4rem .6rem; border-bottom: 1px solid #1f2430; font-size: 12px; color: #89b4fa; }
.agent-col .events { overflow-y: auto; padding: .4rem .6rem; flex: 1; }
.ev { padding: .15rem 0; white-space: pre-wrap; word-break: break-word; border-bottom: 1px dotted #1b2230; }
.ev .k { color: #6c7086; }
.ev.agent\.thinking .t { color: #9399b2; font-style: italic; }
.ev.agent\.tool_call .t { color: #f9e2af; }
.ev.agent\.tool_result .t { color: #94e2d5; }
.ev.agent\.error .t { color: #f38ba8; }
.timeline { background: #0d1018; border-left: 1px solid #1f2430; overflow-y: auto; padding: .5rem .7rem; }
.timeline h2 { font-size: 12px; color: #cba6f7; }
.timeline ol { list-style: none; margin: 0; padding: 0; }
.timeline li { padding: .2rem 0; border-bottom: 1px dotted #1b2230; color: #bac2de; }
.timeline li .role { color: #89b4fa; }
```

- [ ] **Step 3: Create `src/observability/public/app.js`**

```js
const statusEl = document.getElementById("status");
const agentsEl = document.getElementById("agents");
const timelineEl = document.getElementById("timeline-list");
const columns = new Map();

function column(role) {
  if (columns.has(role)) return columns.get(role);
  const col = document.createElement("div");
  col.className = "agent-col";
  const h = document.createElement("h3");
  h.textContent = role;
  const events = document.createElement("div");
  events.className = "events";
  col.append(h, events);
  agentsEl.append(col);
  columns.set(role, events);
  return events;
}

function render(e) {
  const events = column(e.role);
  const div = document.createElement("div");
  div.className = "ev " + e.kind;
  const label = e.tool ? `${e.kind} ${e.tool}` : e.kind;
  div.innerHTML = `<span class="k">${label}</span> <span class="t"></span>`;
  div.querySelector(".t").textContent = e.text ?? (e.data ? JSON.stringify(e.data) : "");
  events.append(div);
  events.scrollTop = events.scrollHeight;

  if (e.channel === "orchestrator" || e.kind === "agent.tool_call") {
    const li = document.createElement("li");
    const time = (e.at || "").slice(11, 19);
    li.innerHTML = `${time} <span class="role">${e.role}</span> ${e.kind}${e.tool ? " · " + e.tool : ""}`;
    timelineEl.append(li);
    timelineEl.scrollTop = timelineEl.scrollHeight;
  }
}

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { statusEl.textContent = "connected"; statusEl.className = "connected"; };
  ws.onclose = () => { statusEl.textContent = "disconnected · retrying"; statusEl.className = "disconnected"; setTimeout(connect, 1000); };
  ws.onmessage = (msg) => { try { render(JSON.parse(msg.data)); } catch {} };
}
connect();
```

- [ ] **Step 4: Run the full server test (both cases now pass)**

Run: `npx vitest run test/observability/server.test.ts`
Expected: PASS (2 tests) — the `/` route now serves the dashboard html.

- [ ] **Step 5: Commit**

```bash
git add src/observability/public
git commit -m "feat(observability): vanilla-JS mission-control dashboard"
```

---

## Task 10: `adapt console` demo command + wiring

**Files:**
- Create: `src/observability/console.ts`, `src/cli/commands/console.ts`
- Modify: `src/cli/index.ts` (register the command)
- Test: `test/cli/console.test.ts`

`demoConsole` wires engine → bus → decision log → server, runs one stub agent so you can *see the pipe working end-to-end* in the browser, and (in test mode) returns the captured events without blocking.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { demoConsole } from "../../src/observability/console.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("demoConsole", () => {
  it("runs a stub agent, logs events to the decision log, and serves on a port", async () => {
    dir = makeTmpDir();
    const handle = await demoConsole({ targetRepo: dir, port: 0, runStub: true });
    expect(handle.port).toBeGreaterThan(0);
    await handle.ranStub; // resolves when the stub agent finishes
    const { DecisionLog } = await import("../../src/observability/decisionLog.ts");
    const today = new Date().toISOString().slice(0, 10);
    const events = new DecisionLog(dir!).readDay(today);
    expect(events.some((e) => e.channel === "agent")).toBe(true);
    await handle.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/console.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementations**

`src/observability/console.ts`:

```ts
import { EventBus } from "./eventBus.ts";
import { ObservabilityServer } from "./server.ts";
import { DecisionLog } from "./decisionLog.ts";
import { fromAgentEvent, type ConsoleEvent } from "./events.ts";
import { StubEngine } from "../engine/stubEngine.ts";
import { runAgent } from "../engine/runAgent.ts";

export interface DemoConsoleOptions {
  targetRepo: string;
  port: number;
  runStub?: boolean;
}

export interface ConsoleHandle {
  port: number;
  bus: EventBus<ConsoleEvent>;
  ranStub: Promise<void>;
  stop: () => Promise<void>;
}

/** Wire engine -> bus -> {decision log, server}. Optionally run one stub agent as a smoke signal. */
export async function demoConsole(opts: DemoConsoleOptions): Promise<ConsoleHandle> {
  const bus = new EventBus<ConsoleEvent>();
  const log = new DecisionLog(opts.targetRepo);
  bus.subscribe((e) => log.append(e));

  const server = new ObservabilityServer(bus);
  const port = await server.start(opts.port);

  let ranStub: Promise<void> = Promise.resolve();
  if (opts.runStub) {
    ranStub = runAgent(
      new StubEngine(),
      { role: "demo", prompt: "prove the console pipe works", cwd: opts.targetRepo },
      (e) => bus.publish(fromAgentEvent(e)),
    ).then(() => undefined);
  }

  return { port, bus, ranStub, stop: () => server.stop() };
}
```

`src/cli/commands/console.ts`:

```ts
import { demoConsole } from "../../observability/console.ts";

export interface ConsoleCmdOptions {
  targetRepo: string;
  port: number;
}

/** `adapt console`: start mission control and keep it running until Ctrl-C. */
export async function runConsole(opts: ConsoleCmdOptions, log = console.log): Promise<void> {
  const handle = await demoConsole({ targetRepo: opts.targetRepo, port: opts.port, runStub: true });
  log(`adapt console at http://127.0.0.1:${handle.port}  (Ctrl-C to stop)`);
  process.on("SIGINT", () => { void handle.stop().then(() => process.exit(0)); });
}
```

- [ ] **Step 4: Register the command — modify `src/cli/index.ts`**

Add this block immediately before the final `program.parseAsync(process.argv);` line:

```ts
program
  .command("console")
  .description("Start the live mission-control console")
  .argument("<targetRepo>", "path to the target product repository")
  .option("--port <port>", "port to serve on", "4399")
  .action(async (targetRepo: string, options: { port: string }) => {
    const { runConsole } = await import("./commands/console.ts");
    await runConsole({ targetRepo, port: Number(options.port) });
  });
```

And add the import at the top of `src/cli/index.ts` is not needed (dynamic import is used above), so no other change.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/cli/console.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Manual end-to-end smoke (watch it live)**

Run:
```bash
mkdir -p /tmp/adapt-console && npm run adapt -- init /tmp/adapt-console >/dev/null && npm run adapt -- console /tmp/adapt-console --port 4399
```
Then open `http://127.0.0.1:4399` in a browser. Expected: the dashboard shows a `demo` column with `agent.start → agent.text → agent.exit`, the timeline lists the orchestrator/tool entries, and the status pill reads "connected". Stop with Ctrl-C. Clean up: `rm -rf /tmp/adapt-console`.

- [ ] **Step 7: Full Phase 0 suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: every test file across Plans 1–3 PASSES; `tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add src/observability/console.ts src/cli/commands/console.ts src/cli/index.ts test/cli/console.test.ts
git commit -m "feat(cli): adapt console wires engine->bus->log->dashboard end-to-end"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (blueprint §11, §9):** subprocess capture of streaming agent output → Tasks 2–4; normalized events feeding the console + a global timeline → Tasks 6, 9; per-agent panes + state/timeline → Task 9; durable replayable decision log → Task 7; the live web dashboard over websockets → Tasks 8–9; the engine seam that Phase 1 roles plug into (`AgentEngine`, `AgentSpec.mcpServers`) → Task 1. The `emit` callback from Plan 2's `Orchestrator` maps through `fromOrchestratorEvent` (Task 6) onto the same bus — wired fully when Phase 1 instantiates the orchestrator with `emit: (e) => bus.publish(fromOrchestratorEvent(e))`.
- **Placeholder scan:** none — every step has complete code and a concrete command with expected output.
- **Type consistency:** `AgentEvent`/`AgentSpec`/`AgentResult`/`AgentEngine` (Task 1) are reused by both engines, `runAgent`, and `demoConsole`. `ConsoleEvent` (Task 6) is the single shape on the bus, in the decision log, on the wire, and in `app.js`. `OrchestratorEvent` is imported from Plan 2 (Task 6) — confirm Plan 2 exports it (it does, from `orchestrator.ts`).
- **Out of scope (Phase 1):** real role prompts + MCP server config, the Playwright scenario runner, Jira triage, the implementation/verification agents, and the continuous cycle loop. Phase 0 ends with a watchable, controllable, persistent harness driven by a stub agent.
- **Executor note:** the second assertion in Task 8's test (`/` serves html) depends on Task 9's files; run Tasks 8 and 9 in order, or run the targeted `-t "streams live"` command shown in Task 8 Step 4 before Task 9.
```
