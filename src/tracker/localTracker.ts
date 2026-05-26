import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import { WorkItemSchema, type WorkItem } from "./workItem.ts";

/** Canonical local store of work-items: one JSON file per item in .adapt/work-items/. */
export class LocalTracker {
  private dir: string;

  constructor(targetRepo: string) {
    this.dir = workspacePaths(targetRepo).workItemsDir;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  list(): WorkItem[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && f.startsWith("ITEM-"))
      .map((f) => WorkItemSchema.parse(JSON.parse(readFileSync(join(this.dir, f), "utf8"))))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  findByDedupeKey(key: string): WorkItem | undefined {
    return this.list().find((i) => i.dedupeKey === key);
  }

  allLinkedRunIds(): Set<string> {
    return new Set(this.list().flatMap((i) => i.runIds));
  }

  nextId(): string {
    return `ITEM-${String(this.list().length + 1).padStart(3, "0")}`;
  }

  create(item: WorkItem): void {
    writeFileSync(this.fileFor(item.id), JSON.stringify(WorkItemSchema.parse(item), null, 2) + "\n", "utf8");
  }

  appendRun(itemId: string, runId: string): void {
    const item = WorkItemSchema.parse(JSON.parse(readFileSync(this.fileFor(itemId), "utf8")));
    if (!item.runIds.includes(runId)) item.runIds.push(runId);
    writeFileSync(this.fileFor(itemId), JSON.stringify(item, null, 2) + "\n", "utf8");
  }

  update(item: WorkItem): void {
    writeFileSync(this.fileFor(item.id), JSON.stringify(WorkItemSchema.parse(item), null, 2) + "\n", "utf8");
  }
}
