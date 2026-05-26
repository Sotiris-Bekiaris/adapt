import { Command } from "commander";
import { runInit } from "./commands/init.ts";

const program = new Command();
program.name("adapt").description("Agent Development for Autonomous ProducTs").version("0.0.0");

program
  .command("init")
  .description("Scaffold the .adapt workspace inside a target repo")
  .argument("<targetRepo>", "path to the target product repository")
  .option("--app-base-url <url>", "base URL of the running app", "http://localhost:3000")
  .action((targetRepo: string, options: { appBaseUrl: string }) => {
    const code = runInit({ targetRepo, appBaseUrl: options.appBaseUrl });
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

program.parseAsync(process.argv);
