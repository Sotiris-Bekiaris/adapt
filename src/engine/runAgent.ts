import type { AgentEngine, AgentEvent, AgentResult, AgentSpec } from "./types.ts";

/** Run an engine, forwarding each streamed event to `sink`. Returns the final result. */
export function runAgent(
  engine: AgentEngine,
  spec: AgentSpec,
  sink: (e: AgentEvent) => void,
): Promise<AgentResult> {
  return engine.run(spec, sink);
}
