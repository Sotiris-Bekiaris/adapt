import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { setScenarioStatus } from "../../src/scenarios/update.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("setScenarioStatus", () => {
  it("rewrites only the status, preserving id/body, and re-parses", () => {
    dir = makeTmpDir();
    mkdirSync(dir, { recursive: true });
    const file = "SCN-001.md";
    writeFileSync(join(dir, file), `---\nid: SCN-001\ntitle: Login\nstatus: regression\npriority: high\npersona: User\ntags: [auth]\nsource: agent-discovered\n---\n# Scenario\nLog in.\n`, "utf8");
    setScenarioStatus(dir, file, "graduated");
    const parsed = parseScenario(readFileSync(join(dir, file), "utf8"), file);
    expect(parsed.meta.status).toBe("graduated");
    expect(parsed.meta.id).toBe("SCN-001");
    expect(parsed.body).toContain("Log in.");
  });
});
