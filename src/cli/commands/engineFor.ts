import type { AdaptConfig } from "../../config/schema.ts";
import type { AgentEngine } from "../../engine/types.ts";
import { StubEngine } from "../../engine/stubEngine.ts";
import { ClaudeCodeEngine, type ClaudeCodeEngineOptions } from "../../engine/claudeCode.ts";

/**
 * The ClaudeCodeEngine options a loaded config implies. Split out from engineFor() so tests can
 * assert the wiring (notably engine.skipPermissions) without spawning anything.
 */
export function engineOptionsFor(
  config: AdaptConfig,
  model?: string,
): ClaudeCodeEngineOptions & { skipPermissions: boolean } {
  return {
    command: config.engine.command,
    model,
    skipPermissions: config.engine.skipPermissions,
  };
}

/**
 * The engine a command drives, from config: engine.type picks the implementation, engine.command
 * the binary, engine.skipPermissions whether agents get --dangerously-skip-permissions.
 * `adapt init` deliberately does not use this — it runs the Scout before any config exists.
 */
export function engineFor(config: AdaptConfig, model?: string): AgentEngine {
  return config.engine.type === "stub"
    ? new StubEngine()
    : new ClaudeCodeEngine(engineOptionsFor(config, model));
}
