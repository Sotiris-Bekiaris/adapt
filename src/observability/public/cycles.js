// Pure cycle/step segmentation for the monitor's "Cycles" view.
// Input: chronological ConsoleEvent[]. Output: Cycle[].
//
// Cycle = { cycle: number|null, status, startedAt: string|null, steps: Step[] }
// Step  = { index, role, status, input: string|null, output: string, summary: string, events: [] }
// status is "running" | "done" | "error".
//
// No DOM, no globals — safe to import in vitest and in the browser as a module.

const SUMMARY_MAX = 80;

function summarize(text) {
  const s = (text ?? "").trim().replace(/\s+/g, " ");
  if (s.length <= SUMMARY_MAX) return s;
  return s.slice(0, SUMMARY_MAX - 1) + "…";
}

export function buildCycles(events) {
  const cycles = [];
  let current = null; // open/last cycle
  let step = null; // open step

  const ensureCycle = () => {
    if (current) return current;
    current = { cycle: null, status: "running", startedAt: null, steps: [] };
    cycles.push(current);
    return current;
  };

  const closeStep = (status) => {
    if (!step) return;
    if (status) step.status = status;
    step = null;
  };

  for (const e of events ?? []) {
    const isOrch = e.channel === "orchestrator";

    if (isOrch && e.kind === "cycle.start") {
      closeStep();
      const n = e.data && typeof e.data.cycle === "number" ? e.data.cycle : null;
      current = { cycle: n, status: "running", startedAt: e.at ?? null, steps: [] };
      cycles.push(current);
      continue;
    }

    if (isOrch && (e.kind === "cycle.completed" || e.kind === "cycle.error")) {
      if (current) current.status = e.kind === "cycle.error" ? "error" : "done";
      closeStep();
      continue;
    }

    if (e.kind === "agent.start") {
      const c = ensureCycle();
      closeStep();
      step = {
        index: c.steps.length + 1,
        role: e.role,
        status: "running",
        input: e.data && typeof e.data.prompt === "string" ? e.data.prompt : null,
        output: "",
        summary: "",
        events: [e],
      };
      c.steps.push(step);
      continue;
    }

    // Any other event attaches to the open step, if there is one.
    ensureCycle();
    if (!step) continue;
    step.events.push(e);
    if (e.kind === "agent.text" && e.text) {
      step.output += e.text;
      step.summary = summarize(e.text);
    }
    if (e.kind === "agent.error") step.status = "error";
    if (e.kind === "agent.exit") closeStep(step.status === "error" ? "error" : "done");
  }

  // Summary fallback: terminal event kind when a step produced no text.
  for (const c of cycles) {
    for (const s of c.steps) {
      if (!s.summary) {
        const last = s.events[s.events.length - 1];
        s.summary = last ? last.kind : "";
      }
    }
  }

  return cycles;
}
