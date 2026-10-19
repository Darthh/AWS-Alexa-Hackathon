import { routeUtterance, type IntentContext } from "@off-peak/core";

/** Bedrock Converse message shapes (the subset the simulator uses). */
export interface ConverseBlock {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input: Record<string, unknown> };
  toolResult?: { toolUseId: string; content: ({ text: string } | { json: unknown })[]; status?: "success" | "error" };
}

export interface ConverseMessage {
  role: "user" | "assistant";
  content: ConverseBlock[];
}

export interface ConverseOutput {
  output: { message: ConverseMessage };
  stopReason: "end_turn" | "tool_use";
}

function toolNames(messages: ConverseMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of messages) for (const b of m.content) if (b.toolUse) names.set(b.toolUse.toolUseId, b.toolUse.name);
  return names;
}

/** Recover routing context (last explained entry, last rate plans) from earlier tool results. */
function contextFrom(messages: ConverseMessage[]): IntentContext {
  const names = toolNames(messages);
  const ctx: IntentContext = {};
  for (const m of messages) {
    for (const b of m.content) {
      if (!b.toolResult) continue;
      const json = b.toolResult.content.find((c): c is { json: Record<string, any> } => "json" in c)?.json;
      const name = names.get(b.toolResult.toolUseId);
      if (!json) continue;
      if (name === "explain" && json.entry?.id) ctx.lastEntryId = json.entry.id;
      if (name === "find_rate_plans" && Array.isArray(json.plans)) ctx.ratePlans = json.plans;
    }
  }
  return ctx;
}

let seq = 0;

/**
 * Scripted "model" with the Converse response shape: routes the latest user utterance with the
 * same intent router as the web client's scripted mode, emits one toolUse at a time, then answers
 * with the last tool's speakable text. Zero cost, deterministic.
 */
export function mockConverse(messages: ConverseMessage[]): ConverseOutput {
  const lastUser = messages.findLastIndex((m) => m.role === "user" && m.content.some((b) => typeof b.text === "string"));
  const utterance = lastUser >= 0 ? messages[lastUser]!.content.map((b) => b.text ?? "").join(" ") : "";
  const intent = routeUtterance(utterance, contextFrom(messages.slice(0, Math.max(0, lastUser))));
  const results = messages.slice(lastUser + 1).flatMap((m) => (m.role === "user" ? m.content.filter((b) => b.toolResult) : []));

  if (results.length < intent.calls.length) {
    const next = intent.calls[results.length]!;
    seq += 1;
    return {
      output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: `mock_${seq}`, name: next.tool, input: next.args } }] } },
      stopReason: "tool_use",
    };
  }
  const last = results.at(-1)?.toolResult;
  const text = last?.content.find((c): c is { text: string } => "text" in c)?.text ?? intent.fallback ?? "Okay.";
  return { output: { message: { role: "assistant", content: [{ text }] } }, stopReason: "end_turn" };
}
