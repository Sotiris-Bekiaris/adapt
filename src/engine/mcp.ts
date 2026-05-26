import type { AdaptConfig } from "../config/schema.ts";

export type RoleName = "runner" | "triage" | "implementation" | "verification";

/**
 * Logical MCP server names to expose to a role, filtered by config toggles.
 * Black-box roles (runner, verification) drive a browser via Playwright; white-box
 * roles (triage, implementation) use Chrome DevTools for deep inspection. Jira is
 * exposed to every role except the runner, when enabled. The runner never touches Jira.
 * Mapping these logical names to concrete `--mcp-config` paths happens at real-run
 * wiring time; Phase 1 logic + tests operate on the names.
 */
export function mcpServersFor(role: RoleName, config: AdaptConfig): string[] {
  const out: string[] = [];
  const blackBox = role === "runner" || role === "verification";
  if (blackBox) {
    if (config.mcp.playwright.enabled) out.push("playwright");
  } else {
    if (config.mcp.chromeDevTools.enabled) out.push("chrome-devtools");
  }
  if (config.mcp.jira.enabled && role !== "runner") out.push("jira");
  return out;
}
