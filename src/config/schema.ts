import { z } from "zod";

export const AdaptConfigSchema = z.object({
  // Target coupling (blueprint §10, principle 9)
  targetRepoPath: z.string().min(1),
  appBaseUrl: z.string().url(),
  playwrightTestDir: z.string().default("tests/adapt"),
  startCommand: z.string().optional(),

  // Coding-agent engine that backs every role (blueprint §9)
  engine: z.object({
    type: z.enum(["claude-code", "stub"]).default("claude-code"),
    command: z.string().optional(), // override binary/path; defaults set by the engine adapter (Plan 3)
    // Pass --dangerously-skip-permissions to Claude Code. Read by every command that builds an
    // engine (src/cli/commands/engineFor.ts); set it to false to make agents ask for permission.
    skipPermissions: z.boolean().default(true),
  }).prefault({}),

  // Live console (blueprint §11)
  console: z.object({
    port: z.number().int().positive().default(4399),
  }).prefault({}),

  // Global default DB lifecycle hooks; scenario-level hooks override (blueprint §13)
  hooks: z.object({
    setup: z.string().optional(),
    teardown: z.string().optional(),
    requireSetupHook: z.boolean().default(false),
  }).prefault({}),

  // Work tracker: Jira behind an adapter (blueprint §9–10). Opt-in: out of the box adapt uses its
  // built-in local tracker (src/tracker/localTracker.ts), which needs no external service. Turning
  // it on requires a reachable Jira Server/DC or Cloud instance and the mcp-atlassian MCP server.
  //
  // Only projectKey lives here. The connection itself (URL + credentials) comes from the JIRA_*
  // environment variables that adapt forwards into mcp-atlassian (src/engine/claudeCode.ts), and
  // the on/off switch is mcp.jira.enabled below. Issue type and workflow transition names are not
  // configurable: they are literals in the agent prompts (src/agents/prompts/{triage,
  // implementation,verification}.ts). Keys nothing reads do not belong in a schema.
  jira: z.object({
    projectKey: z.string().default(""), // Jira project agents file issues in, e.g. "ADAPT"
  }).prefault({}),

  // MCP servers exposed per role (blueprint §9)
  mcp: z.object({
    playwright: z.object({ enabled: z.boolean().default(true) }).prefault({}),
    chromeDevTools: z.object({ enabled: z.boolean().default(true) }).prefault({}),
    // Off by default: adapt's local tracker needs no external service. This is the single gate on
    // attaching the jira MCP server to a role (src/engine/mcp.ts) and on the Jira instructions in
    // the agent prompts (src/orchestrator/{triage,repair}.ts).
    jira: z.object({ enabled: z.boolean().default(false) }).prefault({}),
  }).prefault({}),

  // Safety limits (blueprint §14)
  limits: z.object({
    maxFixAttempts: z.number().int().positive().default(2),
    maxVerificationAttempts: z.number().int().positive().default(3),
    maxItemsPerRun: z.number().int().positive().default(10),
    maxCycleSeconds: z.number().int().positive().default(3600),
    maxDemandsPerCycle: z.number().int().positive().default(3),
    maxScenariosPerDemand: z.number().int().positive().default(2),
    gradPassThreshold: z.number().int().positive().default(3),
  }).prefault({}),

  // Run guardrails (blueprint §14). null = infinite (default loops forever).
  run: z.object({
    maxCycles: z.number().int().positive().nullable().default(null),
    maxWallClockSeconds: z.number().int().positive().nullable().default(null),
    pauseSeconds: z.number().int().nonnegative().default(5),
    maxConsecutiveErrors: z.number().int().positive().default(3),
  }).prefault({}),

  // Environment orchestration for lanes (Spec: baselines & lanes).
  // Optional — absent means lanes are git-only (no env bring-up/reset).
  environment: z.object({
    up: z.string().optional(),
    down: z.string().optional(),
    reset: z.string().optional(),
    portBase: z.number().int().positive().default(54300),
    portStride: z.number().int().positive().default(100),
  }).optional(),

  // Where lane worktrees are created.
  lanes: z.object({
    rootDir: z.string().default("../adapt-lanes"),
  }).prefault({}),
});

export type AdaptConfig = z.infer<typeof AdaptConfigSchema>;

/** A fully-defaulted example config for scaffolding config.example.json. */
export function defaultConfig(targetRepoPath: string, appBaseUrl: string): AdaptConfig {
  return AdaptConfigSchema.parse({ targetRepoPath, appBaseUrl });
}
