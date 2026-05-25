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
