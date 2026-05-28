import { Command } from "commander";
import { runInit } from "./commands/init.ts";

const program = new Command();
program.name("adapt").description("Agent Development for Autonomous ProducTs").version("0.0.0");

program
  .command("init")
  .description("Scaffold the .adapt workspace inside a target repo")
  .argument("<targetRepo>", "path to the target product repository")
  .option("--app-base-url <url>", "base URL of the running app", "http://localhost:3000")
  .action(async (targetRepo: string, options: { appBaseUrl: string }) => {
    const code = await runInit({ targetRepo, appBaseUrl: options.appBaseUrl });
    process.exit(code);
  });

program
  .command("console")
  .description("Start the live mission-control console")
  .argument("<targetRepo>", "path to the target product repository")
  .option("--port <port>", "port to serve on", "4399")
  .action(async (targetRepo: string, options: { port: string }) => {
    const { runConsole } = await import("./commands/console.ts");
    await runConsole({ targetRepo, port: Number(options.port) });
  });

program
  .command("run-scenarios")
  .description("Run ready scenarios against the target app")
  .argument("<targetRepo>", "path to the target product repository")
  .option("--scenario <id>", "run a single scenario by id (e.g. SCN-001)")
  .action(async (targetRepo: string, options: { scenario?: string }) => {
    const { runReadyScenariosCmd } = await import("./commands/runScenarios.ts");
    const res = await runReadyScenariosCmd({ targetRepo, scenarioId: options.scenario });
    process.exit(res.code);
  });

program
  .command("triage-failures")
  .description("Triage failed runs into deduplicated, classified work-items")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { triageFailuresCmd } = await import("./commands/triageFailures.ts");
    const res = await triageFailuresCmd({ targetRepo });
    process.exit(res.code);
  });

program
  .command("orchestrate")
  .description("Run one bounded autonomous pass: validate -> triage -> repair -> verify")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { orchestrateCmd } = await import("./commands/orchestrate.ts");
    const res = await orchestrateCmd({ targetRepo });
    process.exit(res.code);
  });

program
  .command("evolve")
  .description("Run one full evolutionary pass: dream -> critique -> generate -> validate -> triage -> repair -> verify")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { evolveCmd } = await import("./commands/evolve.ts");
    const res = await evolveCmd({ targetRepo });
    process.exit(res.code);
  });

program
  .command("run")
  .description("Run the organism continuously (bounded evolve loop) until a guardrail or Ctrl-C")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { runCmd, requestRunStop } = await import("./commands/run.ts");
    const signal = { stopped: false };
    process.on("SIGINT", () => {
      if (!requestRunStop(signal, (msg) => process.stderr.write(`${msg}\n`))) process.exit(130);
    });
    const res = await runCmd({ targetRepo, signal });
    process.exit(res.code);
  });

const baseline = program.command("baseline").description("Manage baselines (shared fork points)");
baseline
  .command("create")
  .description("Tag the current target state as a named baseline")
  .argument("<name>", "baseline name (e.g. v1)")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (name: string, targetRepo: string) => {
    const { baselineCreateCmd } = await import("./commands/baseline.ts");
    process.exit(baselineCreateCmd({ targetRepo, name }).code);
  });
baseline
  .command("list")
  .description("List baselines")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { baselineListCmd } = await import("./commands/baseline.ts");
    process.exit(baselineListCmd({ targetRepo }).code);
  });

const lane = program.command("lane").description("Manage lanes (parallel evolutionary lineages)");
lane
  .command("create")
  .description("Fork a baseline into a new isolated lane")
  .argument("<laneId>", "lane id (lowercase, digits, hyphens)")
  .argument("<targetRepo>", "path to the target product repository")
  .requiredOption("--baseline <name>", "baseline to fork from")
  .option("--model <model>", "model to drive this lane's loop")
  .action(async (laneId: string, targetRepo: string, options: { baseline: string; model?: string }) => {
    const { laneCreateCmd } = await import("./commands/lane.ts");
    process.exit(laneCreateCmd({ targetRepo, laneId, baseline: options.baseline, model: options.model }).code);
  });
lane
  .command("list")
  .description("List lanes")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { laneListCmd } = await import("./commands/lane.ts");
    process.exit(laneListCmd({ targetRepo }).code);
  });
lane
  .command("start")
  .description("Start (and maintain) a lane's autonomous loop")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", "path to the target product repository")
  .option("--detach", "run the loop in the background", false)
  .action(async (laneId: string, targetRepo: string, options: { detach: boolean }) => {
    const { laneStartCmd } = await import("./commands/lane.ts");
    process.exit((await laneStartCmd({ targetRepo, laneId, detach: options.detach })).code);
  });
lane
  .command("stop")
  .description("Stop a lane's background loop")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (laneId: string, targetRepo: string) => {
    const { laneStopCmd } = await import("./commands/lane.ts");
    process.exit(laneStopCmd({ targetRepo, laneId }).code);
  });
lane
  .command("reset")
  .description("Discard a lane's work and restore it to its baseline")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (laneId: string, targetRepo: string) => {
    const { laneResetCmd } = await import("./commands/lane.ts");
    process.exit(laneResetCmd({ targetRepo, laneId }).code);
  });
lane
  .command("destroy")
  .description("Remove a lane (worktree + branch)")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (laneId: string, targetRepo: string) => {
    const { laneDestroyCmd } = await import("./commands/lane.ts");
    process.exit(laneDestroyCmd({ targetRepo, laneId }).code);
  });

program.parseAsync(process.argv);
