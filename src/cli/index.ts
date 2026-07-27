import { Command, InvalidArgumentError } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInit } from "./commands/init.ts";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8"),
) as { version: string; description: string };

const TARGET_REPO_ARG = "path to the target product repository (not this repo)";

/** Commander argument parser for a TCP port: rejects NaN and out-of-range values up front,
 *  so `--port abc` fails loudly instead of listening on a random port. */
function parsePort(flag: string): (raw: string) => number {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new InvalidArgumentError(`${flag} must be an integer between 1 and 65535 (got "${raw}")`);
    }
    return n;
  };
}

/** Ask for confirmation on an irreversible operation. Returns false (and explains why) when
 *  there is no TTY to ask on, so a non-interactive caller must pass --yes deliberately. */
async function confirmDestructive(warning: string[], question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  for (const line of warning) process.stderr.write(`${line}\n`);
  if (!process.stdin.isTTY) {
    process.stderr.write(`aborted: not a terminal, so there is nobody to ask — re-run with --yes to proceed.\n`);
    return false;
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  if (answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes") return true;
  process.stderr.write("aborted: nothing was changed.\n");
  return false;
}

const program = new Command();
program
  .name("adapt")
  .description(pkg.description)
  .version(pkg.version)
  .showHelpAfterError('(run "adapt --help" for usage)');

program.addHelpText(
  "after",
  `
Every command takes the path to the TARGET PRODUCT repository — the app adapt evolves,
not this checkout.

Quick start (the stub engine runs the whole loop offline, with no API credits — except that
'adapt init' below spawns a live Scout agent whenever the 'claude' CLI is on PATH):
  adapt init /path/to/target --app-base-url http://localhost:3000
  cp /path/to/target/.adapt/config.example.json /path/to/target/.adapt/config.json
  # set "engine": { "type": "stub" } in that file
  cp /path/to/target/.adapt/scenarios/examples/example.login.md /path/to/target/.adapt/scenarios/SCN-001.md
  adapt run-scenarios /path/to/target

Real run (needs an authenticated 'claude' CLI and the target app already running):
  adapt run /path/to/target --console 4399     # loop, streaming to the console
  adapt monitor /path/to/target                # all lanes in one dashboard

Agents edit the target repo with permission prompts disabled by default. Point adapt at a
throwaway repo or a dedicated branch, and never at a database you cannot afford to lose.

Exit codes: 0 success · 1 failure · 2 target repo not configured · 130 interrupted.
Docs: https://github.com/Sotiris-Bekiaris/adapt#readme`,
);

program
  .command("init")
  .description("Scaffold the .adapt workspace inside a target repo")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .option("--app-base-url <url>", "base URL the running target app is served on", "http://localhost:3000")
  .action(async (targetRepo: string, options: { appBaseUrl: string }) => {
    const code = await runInit({ targetRepo, appBaseUrl: options.appBaseUrl });
    process.exit(code);
  });

program
  .command("console")
  .description("Serve the single-run event console for one repo")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .option("--port <port>", "port to serve on", parsePort("--port"), 4399)
  .action(async (targetRepo: string, options: { port: number }) => {
    const { runConsole } = await import("./commands/console.ts");
    await runConsole({ targetRepo, port: options.port });
  });

program
  .command("run-scenarios")
  .description("Run the runnable scenarios against the target app")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .option("--scenario <id>", "run one scenario by id, regardless of its status (e.g. SCN-001)")
  .option("--fail-on-failure", "exit non-zero if any scenario did not pass", false)
  .action(async (targetRepo: string, options: { scenario?: string; failOnFailure: boolean }) => {
    const { runReadyScenariosCmd } = await import("./commands/runScenarios.ts");
    const res = await runReadyScenariosCmd({
      targetRepo,
      scenarioId: options.scenario,
      failOnFailure: options.failOnFailure,
    });
    process.exit(res.code);
  });

program
  .command("triage-failures")
  .description("Triage failed runs into deduplicated, classified work-items")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .action(async (targetRepo: string) => {
    const { triageFailuresCmd } = await import("./commands/triageFailures.ts");
    const res = await triageFailuresCmd({ targetRepo });
    process.exit(res.code);
  });

program
  .command("orchestrate")
  .description("Run one bounded autonomous pass: validate → triage → repair → verify")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .action(async (targetRepo: string) => {
    const { orchestrateCmd } = await import("./commands/orchestrate.ts");
    const res = await orchestrateCmd({ targetRepo });
    process.exit(res.code);
  });

program
  .command("evolve")
  .description("Run one full evolutionary pass: dream → critique → generate, then the bounded pass")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .action(async (targetRepo: string) => {
    const { evolveCmd } = await import("./commands/evolve.ts");
    const res = await evolveCmd({ targetRepo });
    process.exit(res.code);
  });

program
  .command("run")
  .description("Loop evolutionary passes continuously until a guardrail stops it or you press Ctrl-C")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .option("--console <port>", "stream live events on this port for the console and monitor to attach to", parsePort("--console"))
  .action(async (targetRepo: string, options: { console?: number }) => {
    const { runCmd, requestRunStop } = await import("./commands/run.ts");
    const signal = { stopped: false };
    process.on("SIGINT", () => {
      if (!requestRunStop(signal, (msg) => process.stderr.write(`${msg}\n`))) process.exit(130);
    });
    const res = await runCmd({ targetRepo, signal, consolePort: options.console });
    process.exit(res.code);
  });

const baseline = program.command("baseline").description("Manage baselines (shared fork points for lanes)");
baseline
  .command("create")
  .description("Tag the target's current HEAD as a named baseline and commit its manifest")
  .argument("<name>", "baseline name (e.g. v1)")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .action(async (name: string, targetRepo: string) => {
    const { baselineCreateCmd } = await import("./commands/baseline.ts");
    process.exit(baselineCreateCmd({ targetRepo, name }).code);
  });
baseline
  .command("list")
  .description("List the baselines recorded in a target repo")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .action(async (targetRepo: string) => {
    const { baselineListCmd } = await import("./commands/baseline.ts");
    process.exit(baselineListCmd({ targetRepo }).code);
  });

const lane = program.command("lane").description("Manage lanes (parallel evolutionary lineages)");
lane
  .command("create")
  .description("Fork a baseline into a new isolated lane worktree")
  .argument("<laneId>", "lane id (lowercase letters, digits, hyphens)")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .requiredOption("--baseline <name>", "baseline to fork from")
  .option("--model <model>", "model to drive this lane's loop")
  .action(async (laneId: string, targetRepo: string, options: { baseline: string; model?: string }) => {
    const { laneCreateCmd } = await import("./commands/lane.ts");
    process.exit(laneCreateCmd({ targetRepo, laneId, baseline: options.baseline, model: options.model }).code);
  });
lane
  .command("list")
  .description("List the lanes forked from a target repo")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .action(async (targetRepo: string) => {
    const { laneListCmd } = await import("./commands/lane.ts");
    process.exit(laneListCmd({ targetRepo }).code);
  });
lane
  .command("start")
  .description("Start a lane's autonomous loop")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .option("--detach", "run the loop in the background and return immediately", false)
  .action(async (laneId: string, targetRepo: string, options: { detach: boolean }) => {
    const { laneStartCmd } = await import("./commands/lane.ts");
    process.exit((await laneStartCmd({ targetRepo, laneId, detach: options.detach })).code);
  });
lane
  .command("stop")
  .description("Stop a lane's background loop")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .action(async (laneId: string, targetRepo: string) => {
    const { laneStopCmd } = await import("./commands/lane.ts");
    process.exit(laneStopCmd({ targetRepo, laneId }).code);
  });
lane
  .command("reset")
  .description("Hard-reset a lane to its baseline, destroying every change made in it")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .option("-y, --yes", "skip the confirmation prompt", false)
  .action(async (laneId: string, targetRepo: string, options: { yes: boolean }) => {
    const ok = await confirmDestructive(
      [
        `WARNING: resetting lane "${laneId}" runs "git reset --hard" on its worktree, deletes its`,
        `         state.db, and re-runs the target's environment.reset command.`,
        `         Every commit and every uncommitted change made in that lane is lost. There is no undo.`,
      ],
      `Reset lane "${laneId}"?`,
      options.yes,
    );
    if (!ok) process.exit(1);
    const { laneResetCmd } = await import("./commands/lane.ts");
    process.exit(laneResetCmd({ targetRepo, laneId }).code);
  });
lane
  .command("destroy")
  .description("Permanently remove a lane: its worktree, its branch, and all work in it")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .option("-y, --yes", "skip the confirmation prompt", false)
  .action(async (laneId: string, targetRepo: string, options: { yes: boolean }) => {
    const ok = await confirmDestructive(
      [
        `WARNING: destroying lane "${laneId}" runs the target's environment.down command, removes the`,
        `         lane worktree, and force-deletes its branch adapt/${laneId}.`,
        `         Every commit made in that lane is lost. There is no undo.`,
      ],
      `Destroy lane "${laneId}"?`,
      options.yes,
    );
    if (!ok) process.exit(1);
    const { laneDestroyCmd } = await import("./commands/lane.ts");
    process.exit(laneDestroyCmd({ targetRepo, laneId }).code);
  });

program
  .command("monitor")
  .description("Serve the multi-lane dashboard for every lane forked from a target repo")
  .argument("<targetRepo>", TARGET_REPO_ARG)
  .option("--port <port>", "port to serve on", parsePort("--port"), 4500)
  .action(async (targetRepo: string, options: { port: number }) => {
    const { runMonitor } = await import("./commands/monitor.ts");
    await runMonitor({ targetRepo, port: options.port });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  // ConfigError is matched by name so this entry point never statically imports the config
  // module (and with it zod) just to classify a failure.
  const isConfigError =
    err instanceof Error && (err.name === "ConfigError" || err.constructor?.name === "ConfigError");
  process.stderr.write(`adapt: ${msg}\n`);
  if (process.env.ADAPT_DEBUG && err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  } else {
    process.stderr.write(`(set ADAPT_DEBUG=1 for the full stack trace)\n`);
  }
  process.exit(isConfigError ? 2 : 1);
});
