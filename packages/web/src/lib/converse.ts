import { routeUtterance, type IntentContext } from "@off-peak/core";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { toolText, type McpConn } from "./mcp.ts";

export interface ConverseBlock {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input: Record<string, unknown> };
  toolResult?: { toolUseId: string; content: ({ text: string } | { json: unknown })[]; status?: "success" | "error" };
}

export interface ConverseMessage {
  role: "user" | "assistant";
  content: ConverseBlock[];
}

export interface ToolEvent {
  name: string;
  args: Record<string, unknown>;
  result: CallToolResult;
}

export interface TurnResult {
  reply: string;
  toolCalls: number;
  brain: "bedrock" | "mock" | "scripted";
  error?: boolean;
}

const MAX_TOOL_CALLS = 5;
const MAX_HISTORY = 24;

/** MCP tools → Bedrock Converse toolSpec (JSON Schema in inputSchema.json). */
export function toolSpecs(tools: Tool[]) {
  return tools.map((t) => {
    const { $schema: _ignored, ...schema } = t.inputSchema as Record<string, unknown>;
    return { toolSpec: { name: t.name, description: t.description ?? t.name, inputSchema: { json: schema } } };
  });
}

/** Keep the LLM payload small: the timeline is for screens, not for the model. */
function forModel(structured: unknown): Record<string, unknown> {
  if (!structured || typeof structured !== "object") return {};
  const { timeline: _t, ...rest } = structured as Record<string, unknown>;
  return rest;
}

/**
 * One conversation with the simulated Alexa. In "llm" mode the server proxy (Bedrock or mock) picks
 * tools and the browser calls MCP; in "scripted" mode a regex router picks them (no LLM at all).
 */
export class Conversation {
  messages: ConverseMessage[] = [];
  ctx: IntentContext = {};
  readonly #conn: McpConn;
  readonly #serverBase: string;
  readonly #onTool: (e: ToolEvent) => void;

  constructor(conn: McpConn, serverBase: string, onTool: (e: ToolEvent) => void) {
    this.#conn = conn;
    this.#serverBase = serverBase;
    this.#onTool = onTool;
  }

  async #call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = await this.#conn.callTool(name, args);
    const s = result.structuredContent as Record<string, any> | undefined;
    if (name === "explain" && s?.entry?.id) this.ctx.lastEntryId = s.entry.id;
    if (name === "find_rate_plans" && Array.isArray(s?.plans)) this.ctx.ratePlans = s.plans;
    this.#onTool({ name, args, result });
    return result;
  }

  async askScripted(text: string): Promise<TurnResult> {
    const intent = routeUtterance(text, this.ctx);
    let reply = intent.fallback ?? "";
    for (const c of intent.calls) reply = toolText(await this.#call(c.tool, c.args));
    return { reply, toolCalls: intent.calls.length, brain: "scripted" };
  }

  #trim(): void {
    if (this.messages.length <= MAX_HISTORY) return;
    let start = this.messages.length - MAX_HISTORY;
    // Never start on a dangling toolResult/toolUse: begin at a plain user utterance.
    while (start < this.messages.length && !(this.messages[start]!.role === "user" && this.messages[start]!.content.some((b) => b.text !== undefined))) start++;
    this.messages = this.messages.slice(start);
  }

  async askLlm(text: string): Promise<TurnResult> {
    this.messages.push({ role: "user", content: [{ text }] });
    const tools = toolSpecs(this.#conn.tools);
    let calls = 0;
    let brain: TurnResult["brain"] = "mock";
    for (let round = 0; round <= MAX_TOOL_CALLS; round++) {
      const res = await fetch(`${this.#serverBase}/llm/converse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: this.messages, tools }),
      });
      const body = (await res.json()) as { output?: { message: ConverseMessage }; stopReason?: string; mode?: string; speakable?: string };
      if (!res.ok || !body.output) {
        this.messages.pop();
        return { reply: body.speakable ?? "Sorry, I couldn't reach my brain. Try scripted mode.", toolCalls: calls, brain, error: true };
      }
      brain = body.mode === "bedrock" ? "bedrock" : "mock";
      const msg = body.output.message;
      this.messages.push(msg);
      const uses = msg.content.filter((b) => b.toolUse).map((b) => b.toolUse!);
      if (!uses.length || body.stopReason !== "tool_use") {
        this.#trim();
        const reply = msg.content.map((b) => b.text ?? "").join(" ").trim();
        return { reply: reply || "Okay.", toolCalls: calls, brain };
      }
      const results: ConverseBlock[] = [];
      for (const u of uses) {
        if (calls >= MAX_TOOL_CALLS) {
          results.push({ toolResult: { toolUseId: u.toolUseId, content: [{ text: "Tool call limit reached for this turn." }], status: "error" } });
          continue;
        }
        calls++;
        try {
          const r = await this.#call(u.name, u.input ?? {});
          results.push({
            toolResult: {
              toolUseId: u.toolUseId,
              content: [{ text: toolText(r) }, ...(r.structuredContent ? [{ json: forModel(r.structuredContent) }] : [])],
              status: r.isError ? "error" : "success",
            },
          });
        } catch (err) {
          results.push({ toolResult: { toolUseId: u.toolUseId, content: [{ text: `Tool failed: ${(err as Error).message}` }], status: "error" } });
        }
      }
      this.messages.push({ role: "user", content: results });
    }
    return { reply: "Sorry, that took too many steps.", toolCalls: calls, brain, error: true };
  }
}
