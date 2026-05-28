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
  lane?: string;
}

export function fromAgentEvent(e: AgentEvent): ConsoleEvent {
  return { channel: "agent", role: e.role, kind: e.kind, at: e.at, text: e.text, tool: e.tool, data: e.data };
}

export function fromOrchestratorEvent(e: OrchestratorEvent): ConsoleEvent {
  const { type, at, ...rest } = e;
  return { channel: "orchestrator", role: "orchestrator", kind: type, at, data: rest };
}
