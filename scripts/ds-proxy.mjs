// Request-normalizing proxy for DeepSeek's Anthropic-compatible endpoint.
//
// Finding (from logging real traffic): Claude Code sends thinking:{type:"adaptive"} for main-agent
// calls (DeepSeek v4-pro accepts these) but thinking:{type:"disabled"} for subagent dispatches —
// and v4-pro is a reasoning model that REJECTS disabled thinking (HTTP 400, worded as
// "thinking options type cannot be disabled when reasoning_effort is set"). There is no top-level
// reasoning_effort to strip; the conflict is the "disabled" type itself.
//
// Fix: rewrite thinking:{type:"disabled"} -> {type:"adaptive"} so subagent calls match the shape
// v4-pro already accepts. Subagents then run on v4-pro (and think, which is fine). Main-agent calls
// pass through untouched. Streaming responses pass straight through; the caller's Authorization
// header is forwarded as-is (no secrets stored here).
import http from "node:http";
import https from "node:https";

const PORT = Number(process.argv[2] ?? 8788);
const UPSTREAM_HOST = "api.deepseek.com";

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = Buffer.concat(chunks);
    const isMessages = req.method === "POST" && req.url.includes("/v1/messages") && !req.url.includes("count_tokens");
    if (isMessages) {
      try {
        const j = JSON.parse(body.toString("utf8"));
        if (j && j.thinking && j.thinking.type === "disabled") {
          j.thinking = { type: "adaptive" };   // match the shape v4-pro already accepts
          body = Buffer.from(JSON.stringify(j), "utf8");
        }
      } catch { /* not JSON we understand — pass through unchanged */ }
    }
    const headers = { ...req.headers, host: UPSTREAM_HOST, "content-length": Buffer.byteLength(body) };
    const up = https.request(
      { host: UPSTREAM_HOST, port: 443, path: req.url, method: req.method, headers },
      (ur) => { res.writeHead(ur.statusCode ?? 502, ur.headers); ur.pipe(res); },
    );
    up.on("error", (e) => { if (!res.headersSent) res.writeHead(502); res.end(`ds-proxy upstream error: ${e.message}`); });
    up.end(body);
  });
  req.on("error", () => { if (!res.headersSent) res.writeHead(400); res.end(); });
});

server.listen(PORT, "127.0.0.1", () => console.log(`ds-proxy → https://${UPSTREAM_HOST} on http://127.0.0.1:${PORT} (rewrites thinking:disabled -> adaptive)`));
