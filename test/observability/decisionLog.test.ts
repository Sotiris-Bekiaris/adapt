import { describe, it, expect, afterEach } from "vitest";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { DecisionLog } from "../../src/observability/decisionLog.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("DecisionLog", () => {
  it("appends events as NDJSON and reads them back in order", () => {
    dir = makeTmpDir();
    const log = new DecisionLog(dir, () => "2026-05-25T10:00:00.000Z");
    log.append({ channel: "orchestrator", role: "orchestrator", kind: "run.created", at: "2026-05-25T10:00:00.000Z" });
    log.append({ channel: "agent", role: "runner", kind: "agent.text", at: "2026-05-25T10:00:01.000Z", text: "hi" });
    const all = log.readDay("2026-05-25");
    expect(all.length).toBe(2);
    expect(all[1]!.text).toBe("hi");
  });

  it("readDay returns [] for a day with no log", () => {
    dir = makeTmpDir();
    const log = new DecisionLog(dir, () => "2026-05-25T10:00:00.000Z");
    expect(log.readDay("2020-01-01")).toEqual([]);
  });
});
