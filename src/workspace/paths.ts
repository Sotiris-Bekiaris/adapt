import { resolve, join } from "node:path";
import { WORKSPACE_DIRNAME } from "../types.ts";

export interface WorkspacePaths {
  targetRepo: string;
  root: string;
  configFile: string;
  northStar: string;
  scenariosDir: string;
  scenarioIndex: string;
  runsDir: string;
  workItemsDir: string;
  verificationReportsDir: string;
  decisionLogDir: string;
}

/** Resolve every workspace path from a target repo directory. Pure — no IO. */
export function workspacePaths(targetRepo: string): WorkspacePaths {
  const repo = resolve(targetRepo);
  const root = join(repo, WORKSPACE_DIRNAME);
  const scenariosDir = join(root, "scenarios");
  return {
    targetRepo: repo,
    root,
    configFile: join(root, "config.json"),
    northStar: join(root, "north-star.md"),
    scenariosDir,
    scenarioIndex: join(scenariosDir, "index.json"),
    runsDir: join(root, "scenario-runs"),
    workItemsDir: join(root, "work-items"),
    verificationReportsDir: join(root, "verification-reports"),
    decisionLogDir: join(root, "decision-log"),
  };
}
