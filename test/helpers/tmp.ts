import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Make a throwaway directory; returns its path. Caller passes it to cleanupTmp. */
export function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "adapt-test-"));
}

export function cleanupTmp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
