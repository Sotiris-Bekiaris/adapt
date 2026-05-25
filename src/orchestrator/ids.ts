/** ISO timestamp now. Override in tests for determinism. */
export function defaultClock(): string {
  return new Date().toISOString();
}

/** RUN-YYYYMMDDThhmmss-<seq>. */
export function makeRunId(date: Date, seq: number): string {
  const z = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${date.getUTCFullYear()}${z(date.getUTCMonth() + 1)}${z(date.getUTCDate())}` +
    `T${z(date.getUTCHours())}${z(date.getUTCMinutes())}${z(date.getUTCSeconds())}`;
  return `RUN-${stamp}-${seq}`;
}
