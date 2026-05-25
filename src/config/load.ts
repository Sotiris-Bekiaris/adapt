import { existsSync, readFileSync } from "node:fs";
import { workspacePaths } from "../workspace/paths.ts";
import { AdaptConfigSchema, type AdaptConfig } from "./schema.ts";

export class ConfigError extends Error {}

/** Load, parse, and validate <targetRepo>/.adapt/config.json. Throws ConfigError on any problem. */
export function loadConfig(targetRepo: string): AdaptConfig {
  const { configFile } = workspacePaths(targetRepo);
  if (!existsSync(configFile)) {
    throw new ConfigError(`Config not found at ${configFile}. Run "adapt init" first.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configFile, "utf8"));
  } catch (e) {
    throw new ConfigError(`Config at ${configFile} is not valid JSON: ${(e as Error).message}`);
  }
  const result = AdaptConfigSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config at ${configFile}:\n${detail}`);
  }
  return result.data;
}
