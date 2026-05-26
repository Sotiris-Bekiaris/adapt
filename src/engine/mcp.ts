import type { AdaptConfig } from "../config/schema.ts";

export type RoleName =
  | "runner" | "triage" | "implementation" | "verification"
  | "dreamer" | "critic" | "generator" | "graduation";

/**
 * Logical MCP server names to expose to a role, filtered by config toggles.
 * Black-box roles (runner, verification) drive a browser via Playwright; white-box
 * roles (triage, implementation, dreamer, generator) use Chrome DevTools to inspect/
 * explore. The critic reads only. Jira is exposed to triage/implementation/verification
 * when enabled — never to the runner or the demand roles. Logical names map to concrete
 * --mcp-config paths at real-run wiring time.
 */
export function mcpServersFor(role: RoleName, config: AdaptConfig): string[] {
  const out: string[] = [];
  if (role === "runner" || role === "verification") {
    if (config.mcp.playwright.enabled) out.push("playwright");
  } else if (role === "triage" || role === "implementation" || role === "dreamer" || role === "generator" || role === "graduation") {
    if (config.mcp.chromeDevTools.enabled) out.push("chrome-devtools");
  }
  // critic: no browser.
  const jiraRoles: RoleName[] = ["triage", "implementation", "verification"];
  if (config.mcp.jira.enabled && jiraRoles.includes(role)) out.push("jira");
  return out;
}
