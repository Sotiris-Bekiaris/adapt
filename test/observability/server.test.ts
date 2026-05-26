import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { EventBus } from "../../src/observability/eventBus.ts";
import { ObservabilityServer } from "../../src/observability/server.ts";
import type { ConsoleEvent } from "../../src/observability/events.ts";

let server: ObservabilityServer | undefined;
afterEach(async () => { if (server) await server.stop(); server = undefined; });

function ev(kind: string): ConsoleEvent {
  return { channel: "agent", role: "runner", kind, at: "t" };
}

describe("ObservabilityServer", () => {
  it("replays buffered events then streams live ones over ws", async () => {
    const bus = new EventBus<ConsoleEvent>();
    bus.publish(ev("buffered"));
    server = new ObservabilityServer(bus);
    const port = await server.start(0);

    const got: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    const done = new Promise<void>((resolve) => {
      ws.on("message", (raw) => {
        const e = JSON.parse(raw.toString()) as ConsoleEvent;
        got.push(e.kind);
        if (e.kind === "live") resolve();
      });
    });

    bus.publish(ev("live"));
    await done;
    ws.close();

    expect(got[0]).toBe("buffered");
    expect(got).toContain("live");
  });

  it("serves the dashboard html at /", async () => {
    const bus = new EventBus<ConsoleEvent>();
    server = new ObservabilityServer(bus);
    const port = await server.start(0);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body.toLowerCase()).toContain("<!doctype html");
  });
});
