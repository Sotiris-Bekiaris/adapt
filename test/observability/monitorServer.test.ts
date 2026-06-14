import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { MonitorServer } from "../../src/observability/monitorServer.ts";
import type { ControlCommand } from "../../src/observability/monitorServer.ts";

function waitOpen(s: WebSocket): Promise<void> {
  return new Promise((res) => s.on("open", () => res()));
}

describe("MonitorServer control frames", () => {
  it("dispatches a control frame to the control callback", async () => {
    const received: ControlCommand[] = [];
    const server = new MonitorServer({
      summaries: () => [],
      historyFor: () => [],
      control: (cmd) => { received.push(cmd); },
    });
    const port = await server.start(0);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await waitOpen(ws);
    ws.send(JSON.stringify({ type: "control", lane: "a", action: "pause" }));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    await server.stop();

    expect(received).toEqual([{ lane: "a", action: "pause", maxCycles: undefined }]);
  });

  it("ignores control frames with an unknown action", async () => {
    const received: ControlCommand[] = [];
    const server = new MonitorServer({
      summaries: () => [], historyFor: () => [],
      control: (cmd) => { received.push(cmd); },
    });
    const port = await server.start(0);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await waitOpen(ws);
    ws.send(JSON.stringify({ type: "control", lane: "a", action: "explode" }));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    await server.stop();

    expect(received).toEqual([]);
  });
});
