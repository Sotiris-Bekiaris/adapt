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
