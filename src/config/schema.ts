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
    skipPermissions: z.boolean().default(true), // pass --dangerously-skip-permissions to Claude Code
  }).default({}),

  // Live console (blueprint §11)
  console: z.object({
    port: z.number().int().positive().default(4399),
  }).default({}),

  // Global default DB lifecycle hooks; scenario-level hooks override (blueprint §13)
  hooks: z.object({
    setup: z.string().optional(),
    teardown: z.string().optional(),
    requireSetupHook: z.boolean().default(false),
  }).default({}),

  // Work tracker: Jira behind an adapter (blueprint §9–10)
  jira: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().url().optional(),
    projectKey: z.string().default(""),
    defaultIssueType: z.string().default("Bug"),
    transitions: z.object({
      inReview: z.string().default("In Review"),
      readyForVerification: z.string().default("Ready for Verification"),
      done: z.string().default("Done"),
      reopened: z.string().default("In Progress"),
    }).default({}),
  }).default({}),

  // MCP servers exposed per role (blueprint §9)
  mcp: z.object({
    playwright: z.object({ enabled: z.boolean().default(true) }).default({}),
    chromeDevTools: z.object({ enabled: z.boolean().default(true) }).default({}),
    jira: z.object({ enabled: z.boolean().default(false) }).default({}),
  }).default({}),

  // Safety limits (blueprint §14)
  limits: z.object({
    maxFixAttempts: z.number().int().positive().default(2),
    maxVerificationAttempts: z.number().int().positive().default(3),
    maxItemsPerRun: z.number().int().positive().default(10),
    maxCycleSeconds: z.number().int().positive().default(3600),
    maxDemandsPerCycle: z.number().int().positive().default(3),
    maxScenariosPerDemand: z.number().int().positive().default(2),
    gradPassThreshold: z.number().int().positive().default(3),
  }).default({}),

  // Run guardrails (blueprint §14). null = infinite (default loops forever).
  run: z.object({
    maxCycles: z.number().int().positive().nullable().default(null),
    maxWallClockSeconds: z.number().int().positive().nullable().default(null),
    pauseSeconds: z.number().int().nonnegative().default(5),
    maxConsecutiveErrors: z.number().int().positive().default(3),
  }).default({}),

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
  }).default({}),
});

export type AdaptConfig = z.infer<typeof AdaptConfigSchema>;

/** A fully-defaulted example config for scaffolding config.example.json. */
export function defaultConfig(targetRepoPath: string, appBaseUrl: string): AdaptConfig {
  return AdaptConfigSchema.parse({ targetRepoPath, appBaseUrl });
}
