import type { AgentEvent } from "./types.ts";

/** Translate one stream-json line into AgentEvents. system/result -> []; non-JSON -> a text event. */
export function parseStreamLine(line: string, role: string, now: () => string): AgentEvent[] {
  const trimmed = line.trim();
  if (trimmed === "") return [];

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [{ kind: "agent.text", role, at: now(), text: trimmed }];
  }

  if (obj.type === "system" || obj.type === "result") return [];

  if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
    const out: AgentEvent[] = [];
    for (const block of obj.message.content) {
      if (block.type === "text" && block.text) {
        out.push({ kind: "agent.text", role, at: now(), text: block.text });
      } else if (block.type === "thinking" && block.thinking) {
        out.push({ kind: "agent.thinking", role, at: now(), text: block.thinking });
      } else if (block.type === "tool_use") {
        out.push({ kind: "agent.tool_call", role, at: now(), tool: block.name, data: block.input });
      }
    }
    return out;
  }

  if (obj.type === "user" && Array.isArray(obj.message?.content)) {
    return obj.message.content
      .filter((b: any) => b.type === "tool_result")
      .map((b: any): AgentEvent => ({
        kind: "agent.tool_result", role, at: now(),
        text: typeof b.content === "string" ? b.content : undefined, data: b.content,
      }));
  }

  return [];
}
