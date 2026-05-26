import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { StateStore } from "./store.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { parseScenario } from "../scenarios/parse.ts";
import { setScenarioStatus } from "../scenarios/update.ts";
import { runAgent } from "../engine/runAgent.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { graduationPrompt } from "../agents/prompts/graduation.ts";

export interface GraduateDeps {
  engine: AgentEngine;
  store: StateStore;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** Graduate every non-graduated scenario whose consecutive passes have reached the threshold:
 *  write a deterministic Playwright spec and mark the scenario `graduated`. Returns graduated ids. */
export async function graduateProven(deps: GraduateDeps): Promise<string[]> {
  const { engine, store, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const testDir = join(targetRepo, config.playwrightTestDir);
  const graduated: string[] = [];

  for (const entry of rebuildRegistry(targetRepo)) {
    if (entry.status === "graduated") continue;
    if (store.getScenarioPasses(entry.id) < config.limits.gradPassThreshold) continue;

    const scenario = parseScenario(readFileSync(join(ws.scenariosDir, entry.filename), "utf8"), entry.filename);
    const specPath = join(testDir, `${entry.id}.spec.ts`);
    mkdirSync(testDir, { recursive: true });
    rmSync(specPath, { force: true });

    const result = await runAgent(
      engine,
      {
        role: "graduation",
        prompt: graduationPrompt({ scenario, appBaseUrl: config.appBaseUrl, specPath }),
        cwd: targetRepo,
        mcpServers: mcpServersFor("graduation", config),
      },
      sink,
    );

    if (result.exitCode === 0 && existsSync(specPath) && readFileSync(specPath, "utf8").trim() !== "") {
      setScenarioStatus(ws.scenariosDir, entry.filename, "graduated");
      graduated.push(entry.id);
    } else {
      rmSync(specPath, { force: true });
    }
  }

  rebuildRegistry(targetRepo); // refresh after status changes
  return graduated;
}
