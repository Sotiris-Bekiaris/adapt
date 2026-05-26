import { describe, it, expect, afterEach } from "vitest";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { LocalTracker } from "../../src/tracker/localTracker.ts";
import type { WorkItem } from "../../src/tracker/workItem.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function item(id: string, key: string, runIds: string[]): WorkItem {
  return { id, title: id, scenarioId: "SCN-001", runIds, expected: null, actual: null, classification: "bug", severity: "high", dedupeKey: key, status: "triaged", jiraKey: null, labels: [], notes: "", createdAt: "t" };
}

describe("LocalTracker", () => {
  it("creates, lists, and finds by dedupe key", () => {
    dir = makeTmpDir();
    const t = new LocalTracker(dir);
    t.create(item("ITEM-001", "k1", ["RUN-1"]));
    expect(t.list().length).toBe(1);
    expect(t.findByDedupeKey("k1")?.id).toBe("ITEM-001");
    expect(t.findByDedupeKey("nope")).toBeUndefined();
  });

  it("appendRun adds a runId once (idempotent) without duplicating the item", () => {
    dir = makeTmpDir();
    const t = new LocalTracker(dir);
    t.create(item("ITEM-001", "k1", ["RUN-1"]));
    t.appendRun("ITEM-001", "RUN-2");
    t.appendRun("ITEM-001", "RUN-2"); // again
    expect(t.list().length).toBe(1);
    expect(t.list()[0]!.runIds).toEqual(["RUN-1", "RUN-2"]);
  });

  it("allLinkedRunIds collects every linked run", () => {
    dir = makeTmpDir();
    const t = new LocalTracker(dir);
    t.create(item("ITEM-001", "k1", ["RUN-1", "RUN-2"]));
    t.create(item("ITEM-002", "k2", ["RUN-3"]));
    expect([...t.allLinkedRunIds()].sort()).toEqual(["RUN-1", "RUN-2", "RUN-3"]);
  });

  it("nextId increments based on existing items", () => {
    dir = makeTmpDir();
    const t = new LocalTracker(dir);
    expect(t.nextId()).toBe("ITEM-001");
    t.create(item("ITEM-001", "k1", ["RUN-1"]));
    expect(t.nextId()).toBe("ITEM-002");
  });
});
