import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import type { ConsoleEvent } from "./events.ts";

export class DecisionLog {
  private dir: string;
  private now: () => string;

  constructor(targetRepo: string, now: () => string = () => new Date().toISOString()) {
    this.dir = workspacePaths(targetRepo).decisionLogDir;
    this.now = now;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(day: string): string {
    return join(this.dir, `${day}.ndjson`);
  }

  append(event: ConsoleEvent): void {
    const day = (event.at ?? this.now()).slice(0, 10);
    appendFileSync(this.fileFor(day), JSON.stringify(event) + "\n", "utf8");
  }

  readDay(day: string): ConsoleEvent[] {
    const path = this.fileFor(day);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as ConsoleEvent);
  }
}
