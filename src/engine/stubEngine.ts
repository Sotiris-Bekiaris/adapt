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
