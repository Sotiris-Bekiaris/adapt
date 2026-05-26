import { join } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { parseScenario } from "../scenarios/parse.ts";
import { runAgent } from "../engine/runAgent.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { generatorPrompt } from "../agents/prompts/generator.ts";
import type { Demand } from "./demand.ts";

export interface GenerateDeps {
  engine: AgentEngine;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** The next free SCN number = max existing top-level scenario id + 1 (1 if none). */
export function nextScenarioNumber(targetRepo: string): number {
  const nums = rebuildRegistry(targetRepo).map((e) => {
    const m = e.id.match(/^SCN-(\d+)$/);
    return m ? parseInt(m[1]!, 10) : 0;
  });
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

function pad(n: number): string {
  return `SCN-${String(n).padStart(3, "0")}`;
}

/** Generate scenario files for each approved demand. Node assigns collision-free IDs and
 *  validates every generated file (deleting invalid ones). Returns the created scenarios. */
export async function runGenerate(deps: GenerateDeps, approved: Demand[]): Promise<{ id: string; filename: string }[]> {
  const { engine, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const cap = config.limits.maxScenariosPerDemand;
  const created: { id: string; filename: string }[] = [];

  let nextNum = nextScenarioNumber(targetRepo);

  for (const demand of approved) {
    const assignedIds = Array.from({ length: cap }, (_, i) => pad(nextNum + i));
    await runAgent(
      engine,
      {
        role: "generator",
        prompt: generatorPrompt({ demand, scenariosDir: ws.scenariosDir, assignedIds }),
        cwd: targetRepo,
        mcpServers: mcpServersFor("generator", config),
      },
      sink,
    );

    for (const id of assignedIds) {
      const filename = `${id}.md`;
      const path = join(ws.scenariosDir, filename);
      if (!existsSync(path)) continue;
      try {
        const parsed = parseScenario(readFileSync(path, "utf8"), filename);
        if (parsed.meta.id !== id) { rmSync(path); continue; }
        created.push({ id, filename });
      } catch {
        rmSync(path);
      }
    }
    nextNum += cap;
  }

  rebuildRegistry(targetRepo);
  return created;
}
