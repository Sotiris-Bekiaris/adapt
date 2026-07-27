import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { engineFor, engineOptionsFor } from "../../src/cli/commands/engineFor.ts";
import { buildClaudeArgs } from "../../src/engine/claudeCode.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";

const SKIP_FLAG = "--dangerously-skip-permissions";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

const cfg = (engine: Record<string, unknown> = {}) =>
  AdaptConfigSchema.parse({ targetRepoPath: "/r", appBaseUrl: "http://localhost:3000", engine });

const spec = { role: "triage", prompt: "go", cwd: process.cwd(), mcpServers: [] };

/** A fake `claude` that records the argv it was invoked with, then exits 0. */
function fakeClaude(at: string, argsFile: string): string {
  writeFileSync(at, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\n`, "utf8");
  chmodSync(at, 0o755);
  return at;
}

describe("engineOptionsFor", () => {
  it("threads engine.skipPermissions:false through to args without the skip flag", () => {
    const opts = engineOptionsFor(cfg({ skipPermissions: false }));
    expect(opts.skipPermissions).toBe(false);
    expect(buildClaudeArgs(spec, opts)).not.toContain(SKIP_FLAG);
  });

  it("keeps the skip flag when skipPermissions is true or absent", () => {
    for (const engine of [{ skipPermissions: true }, {}]) {
      const opts = engineOptionsFor(cfg(engine));
      expect(opts.skipPermissions).toBe(true);
      expect(buildClaudeArgs(spec, opts)).toContain(SKIP_FLAG);
    }
  });

  it("carries engine.command and the lane model", () => {
    const opts = engineOptionsFor(cfg({ command: "/usr/local/bin/claude" }), "opus");
    expect(opts.command).toBe("/usr/local/bin/claude");
    expect(buildClaudeArgs(spec, opts).slice(0, 2)).toEqual(["--model", "opus"]);
  });
});

describe("engineFor", () => {
  it("returns a StubEngine when engine.type is stub", () => {
    expect(engineFor(cfg({ type: "stub" }))).toBeInstanceOf(StubEngine);
  });

  it("does not spawn the skip-permissions flag when the config disables it", async () => {
    dir = makeTmpDir();
    const argsFile = join(dir, "argv.txt");
    const engine = engineFor(cfg({ command: fakeClaude(join(dir, "claude.sh"), argsFile), skipPermissions: false }));
    await engine.run({ role: "triage", prompt: "go", cwd: dir }, () => {});
    expect(existsSync(argsFile)).toBe(true);
    expect(readFileSync(argsFile, "utf8").split("\n")).not.toContain(SKIP_FLAG);
  });

  it("spawns the skip-permissions flag when the config leaves it at the default", async () => {
    dir = makeTmpDir();
    const argsFile = join(dir, "argv.txt");
    const engine = engineFor(cfg({ command: fakeClaude(join(dir, "claude.sh"), argsFile) }));
    await engine.run({ role: "triage", prompt: "go", cwd: dir }, () => {});
    expect(readFileSync(argsFile, "utf8").split("\n")).toContain(SKIP_FLAG);
  });
});
