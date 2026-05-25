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
