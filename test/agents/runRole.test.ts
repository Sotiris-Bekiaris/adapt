import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { runRole } from "../../src/agents/runRole.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

const Schema = z.object({ n: z.number() });

// A stub engine whose script writes `payload` (if not null) to the RESULT_FILE path in the prompt.
function engineWriting(payload: unknown | null) {
  return new StubEngine({
    script: (spec) => {
      if (payload !== null) {
        const m = spec.prompt.match(/RESULT_FILE=(.+)/);
        if (m) writeFileSync(m[1]!.trim(), JSON.stringify(payload), "utf8");
      }
      return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
    },
  });
}

describe("runRole", () => {
  it("returns ok with the validated value when the agent writes a valid result", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    const r = await runRole(engineWriting({ n: 42 }), spec, file, Schema, () => {});
    expect(r.status).toBe("ok");
    expect(r.value).toEqual({ n: 42 });
  });

  it("returns missing when no result file is written", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    const r = await runRole(engineWriting(null), spec, file, Schema, () => {});
    expect(r.status).toBe("missing");
  });

  it("returns invalid when the result fails the schema", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    const r = await runRole(engineWriting({ wrong: true }), spec, file, Schema, () => {});
    expect(r.status).toBe("invalid");
  });

  it("clears a stale result file before running (no false carry-over)", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    writeFileSync(file, JSON.stringify({ n: 999 }), "utf8"); // stale from a prior run
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    const r = await runRole(engineWriting(null), spec, file, Schema, () => {});
    expect(r.status).toBe("missing");
  });

  it("forwards agent events to the sink", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    const kinds: string[] = [];
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    await runRole(engineWriting({ n: 1 }), spec, file, Schema, (e) => kinds.push(e.kind));
    expect(kinds).toContain("agent.exit");
  });
});
