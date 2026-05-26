import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { EventBus } from "./eventBus.ts";
import type { ConsoleEvent } from "./events.ts";

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "public");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

interface Conn {
  /** Live events queued until the replay backlog has been flushed. */
  pending: ConsoleEvent[];
  /** True once the backlog has been sent and live events flow directly. */
  ready: boolean;
}

export class ObservabilityServer {
  private http: Server;
  private wss: WebSocketServer;
  private unsub?: () => void;
  private conns = new Map<WebSocket, Conn>();

  constructor(private bus: EventBus<ConsoleEvent>) {
    this.http = createServer((req, res) => this.serveStatic(req.url ?? "/", res));
    this.wss = new WebSocketServer({ server: this.http, path: "/ws" });
    this.wss.on("connection", (socket) => {
      const conn: Conn = { pending: [], ready: false };
      this.conns.set(socket, conn);
      socket.on("close", () => this.conns.delete(socket));
      // Snapshot the backlog at connect time, then flush it before any live
      // events. The flush is deferred a few event-loop turns past the handshake
      // because `ws` silently drops frames that arrive before the client has
      // attached its `message` listener (clients typically attach it right
      // after the `open` event). Live events that arrive in the meantime are
      // queued per-connection so the replay-then-live ordering is preserved.
      const backlog = this.bus.recent();
      setTimeout(() => {
        if (socket.readyState !== socket.OPEN) return;
        for (const e of backlog) socket.send(JSON.stringify(e));
        for (const e of conn.pending) socket.send(JSON.stringify(e));
        conn.pending.length = 0;
        conn.ready = true;
      }, 5);
    });
  }

  private serveStatic(url: string, res: import("node:http").ServerResponse): void {
    const rel = url === "/" ? "index.html" : url.replace(/^\//, "").split("?")[0]!;
    const file = join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }

  /** Start listening. Pass 0 for an ephemeral port. Resolves with the bound port. */
  start(port: number): Promise<number> {
    this.unsub = this.bus.subscribe((e) => {
      const payload = JSON.stringify(e);
      for (const client of this.wss.clients) {
        if (client.readyState !== client.OPEN) continue;
        const conn = this.conns.get(client);
        if (conn && !conn.ready) conn.pending.push(e);
        else client.send(payload);
      }
    });
    return new Promise((resolve) => {
      this.http.listen(port, "127.0.0.1", () => {
        const addr = this.http.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      });
    });
  }

  stop(): Promise<void> {
    this.unsub?.();
    return new Promise((resolve) => {
      this.wss.close(() => this.http.close(() => resolve()));
    });
  }
}
