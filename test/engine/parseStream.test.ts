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
