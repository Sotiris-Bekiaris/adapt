import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Never collect from a dogfooded adapt workspace or a lane worktree that happens
    // to sit inside the tree — those contain generated copies of the target repo.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.adapt/**", "**/adapt-lanes/**"],
    environment: "node",
    globals: false,
    // Some tests bind real loopback ports and spawn real `git`. The whole suite runs in
    // seconds locally; the headroom is for cold, contended CI runners.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
