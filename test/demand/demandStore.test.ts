import { describe, it, expect, afterEach } from "vitest";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { LocalDemandStore } from "../../src/demand/demandStore.ts";
import { newDemand, type Demand } from "../../src/demand/demand.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

const d = (id: string) => newDemand({ id, title: id, rationale: "r", proposedScenarios: [], createdAt: "t" });

describe("LocalDemandStore", () => {
  it("creates, lists, and nextId increments", () => {
    dir = makeTmpDir();
    const s = new LocalDemandStore(dir);
    expect(s.nextId()).toBe("DMD-001");
    s.create(d("DMD-001"));
    expect(s.list().length).toBe(1);
    expect(s.nextId()).toBe("DMD-002");
  });
  it("update changes status; listByStatus filters", () => {
    dir = makeTmpDir();
    const s = new LocalDemandStore(dir);
    s.create(d("DMD-001"));
    const updated: Demand = { ...s.list()[0]!, status: "approved", critique: "ok" };
    s.update(updated);
    expect(s.listByStatus("approved").map((x) => x.id)).toEqual(["DMD-001"]);
    expect(s.listByStatus("proposed")).toEqual([]);
  });
});
