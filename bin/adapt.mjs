#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/cli/index.ts");
const res = spawnSync("npx", ["tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
