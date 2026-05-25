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

program.parseAsync(process.argv);
