import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { ConsoleEvent } from "./events.ts";
import type { LaneSummary } from "./laneRegistry.ts";

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "public");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

export interface MonitorServerDeps {
  summaries: () => LaneSummary[];
  historyFor: (laneId: string) => ConsoleEvent[];
}

export class MonitorServer {
  private http: Server;
  private wss: WebSocketServer;

  constructor(private deps: MonitorServerDeps) {
    this.http = createServer((req, res) => this.serveStatic(req.url ?? "/", res));
    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });
    this.wss.on("connection", (socket) => {
      // Defer the initial snapshot a few turns past the handshake: `ws` silently drops
      // frames sent before the client attaches its `message` listener (clients attach it
      // right after `open`). Same race the ObservabilityServer guards against.
      setTimeout(() => {
        if (socket.readyState !== socket.OPEN) return;
        socket.send(JSON.stringify({ type: "lanes", lanes: this.deps.summaries() }));
      }, 25);
      socket.on("message", (raw) => {
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (
          msg && typeof msg === "object" &&
          (msg as { type?: unknown }).type === "focus" &&
          typeof (msg as { lane?: unknown }).lane === "string"
        ) {
          const lane = (msg as { lane: string }).lane;
          if (socket.readyState !== socket.OPEN) return;
          socket.send(JSON.stringify({ type: "history", lane, events: this.deps.historyFor(lane) }));
        }
      });
    });
  }

  private serveStatic(url: string, res: import("node:http").ServerResponse): void {
    const rel = url === "/" ? "monitor.html" : url.replace(/^\//, "").split("?")[0]!;
    const file = join(PUBLIC_DIR, rel);
    // Require a path-separator boundary so a sibling like "public-evil" can't match.
    if (!file.startsWith(PUBLIC_DIR + sep) || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }

  broadcastEvent(e: ConsoleEvent): void {
    const payload = JSON.stringify({ type: "event", lane: e.lane, event: e });
    this.sendAll(payload);
  }

  broadcastLanes(): void {
    const payload = JSON.stringify({ type: "lanes", lanes: this.deps.summaries() });
    this.sendAll(payload);
  }

  private sendAll(payload: string): void {
    for (const client of this.wss.clients) {
      if (client.readyState !== client.OPEN) continue;
      client.send(payload);
    }
  }

  /** Start listening. Pass 0 for an ephemeral port. Resolves with the bound port. */
  start(port: number): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, "127.0.0.1", () => {
        const addr = this.http.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => this.http.close(() => resolve()));
    });
  }
}
