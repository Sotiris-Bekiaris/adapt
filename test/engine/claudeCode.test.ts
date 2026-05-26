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
