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
