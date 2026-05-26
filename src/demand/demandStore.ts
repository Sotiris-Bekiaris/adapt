import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import { DemandSchema, type Demand, type DemandStatus } from "./demand.ts";

/** Canonical local store of demands: one JSON file per demand in .adapt/demands/. */
export class LocalDemandStore {
  private dir: string;

  constructor(targetRepo: string) {
    this.dir = workspacePaths(targetRepo).demandsDir;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  list(): Demand[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && f.startsWith("DMD-"))
      .map((f) => DemandSchema.parse(JSON.parse(readFileSync(join(this.dir, f), "utf8"))))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  listByStatus(status: DemandStatus): Demand[] {
    return this.list().filter((d) => d.status === status);
  }

  nextId(): string {
    return `DMD-${String(this.list().length + 1).padStart(3, "0")}`;
  }

  create(demand: Demand): void {
    writeFileSync(this.fileFor(demand.id), JSON.stringify(DemandSchema.parse(demand), null, 2) + "\n", "utf8");
  }

  update(demand: Demand): void {
    writeFileSync(this.fileFor(demand.id), JSON.stringify(DemandSchema.parse(demand), null, 2) + "\n", "utf8");
  }
}
