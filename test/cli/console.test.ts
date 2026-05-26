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
