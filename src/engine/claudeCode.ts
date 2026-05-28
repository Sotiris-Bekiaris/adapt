import { spawn } from "node:child_process";
import type { AgentEngine, AgentEvent, AgentResult, AgentSpec } from "./types.ts";
import { parseStreamLine } from "./parseStream.ts";

export interface ClaudeCodeEngineOptions {
  command?: string;                              // default "claude"
  model?: string;                                // optional --model (per-lane)
  argsBuilder?: (spec: AgentSpec) => string[];   // default builds headless stream-json flags
  skipPermissions?: boolean;                     // default true — pass --dangerously-skip-permissions
  now?: () => string;
}

/** Build the claude CLI args for a spec. Exported for testing. */
export function buildClaudeArgs(spec: AgentSpec, opts: { model?: string; skipPermissions: boolean }): string[] {
  const args: string[] = [];
  if (opts.model) args.push("--model", opts.model);
  args.push("-p", spec.prompt, "--output-format", "stream-json", "--verbose");
  if (opts.skipPermissions) args.push("--dangerously-skip-permissions");
  for (const s of spec.mcpServers ?? []) args.push("--mcp-config", s);
  return args;
}

export class ClaudeCodeEngine implements AgentEngine {
  private command: string;
  private argsBuilder: (spec: AgentSpec) => string[];
  private now: () => string;

  constructor(opts: ClaudeCodeEngineOptions = {}) {
    const skipPermissions = opts.skipPermissions ?? true;
    this.command = opts.command ?? "claude";
    this.argsBuilder = opts.argsBuilder ?? ((spec: AgentSpec) =>
      buildClaudeArgs(spec, { model: opts.model, skipPermissions }));
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  run(spec: AgentSpec, onEvent: (e: AgentEvent) => void): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.argsBuilder(spec), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
      });

      const events: AgentEvent[] = [];
      let finalText = "";
      let buf = "";

      const handle = (e: AgentEvent) => {
        events.push(e);
        if (e.kind === "agent.text") finalText += e.text ?? "";
        onEvent(e);
      };

      handle({ kind: "agent.start", role: spec.role, at: this.now() });

      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          for (const ev of parseStreamLine(line, spec.role, this.now)) handle(ev);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        handle({ kind: "agent.error", role: spec.role, at: this.now(), text: chunk.toString() });
      });

      child.on("error", reject);

      child.on("close", (code) => {
        if (buf.trim() !== "") for (const ev of parseStreamLine(buf, spec.role, this.now)) handle(ev);
        handle({ kind: "agent.exit", role: spec.role, at: this.now(), exitCode: code ?? 0 });
        resolve({ role: spec.role, exitCode: code ?? 0, events, finalText });
      });
    });
  }
}
