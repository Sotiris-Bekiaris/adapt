import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import { AdaptConfigSchema, type AdaptConfig } from "./schema.ts";

export class ConfigError extends Error {
  /** Set explicitly so the CLI can classify this without importing the class (and with it zod). */
  override name = "ConfigError";
}

/** Load, parse, and validate <targetRepo>/.adapt/config.json. Throws ConfigError on any problem. */
export function loadConfig(targetRepo: string): AdaptConfig {
  const { configFile } = workspacePaths(targetRepo);
  if (!existsSync(configFile)) {
    const example = join(dirname(configFile), "config.example.json");
    // The workspace existing but being unconfigured is the common case: "adapt init" scaffolds
    // config.example.json and never writes config.json, so re-running init would be a no-op.
    throw new ConfigError(
      existsSync(example)
        ? `config not found at ${configFile}\n` +
          `  The .adapt workspace exists but has not been configured yet. Copy the example and edit it:\n` +
          `    cp ${example} ${configFile}`
        : `config not found at ${configFile}\n` +
          `  There is no adapt workspace here. Scaffold one first:\n` +
          `    adapt init ${targetRepo}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configFile, "utf8"));
  } catch (e) {
    throw new ConfigError(
      `config at ${configFile} is not valid JSON\n` +
        `  ${(e as Error).message}\n` +
        `  Fix the syntax (trailing commas and comments are not valid JSON), or start over:\n` +
        `    cp ${join(dirname(configFile), "config.example.json")} ${configFile}`,
    );
  }
  const result = AdaptConfigSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(
      `config at ${configFile} is not valid — ${result.error.issues.length} problem(s):\n` +
        `${detail}\n` +
        `  Each line is "key: what is wrong with it". Edit those keys and re-run.`,
    );
  }
  checkJiraCoherence(result.data, configFile);
  return result.data;
}

/**
 * Cross-field check that zod cannot express per-key: turning Jira on without a project key leaves
 * the triage agent asking Jira to file an issue in project "". Fail at load time with something the
 * user can act on instead of letting a confused agent discover it mid-cycle.
 */
function checkJiraCoherence(config: AdaptConfig, configFile: string): void {
  if (!config.mcp.jira.enabled || config.jira.projectKey.trim() !== "") return;
  throw new ConfigError(
    `config at ${configFile} enables Jira but leaves jira.projectKey empty\n` +
      `  Set "jira": { "projectKey": "ABC" } to the Jira project agents should file issues in,\n` +
      `  or turn Jira off and use adapt's built-in local tracker:\n` +
      `    "mcp": { "jira": { "enabled": false } }`,
  );
}
