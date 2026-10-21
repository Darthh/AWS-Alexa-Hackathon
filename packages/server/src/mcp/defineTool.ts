import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { OffPeakError, speakable } from "@off-peak/core";
import { z as zod, type z } from "zod";
import { log, logError } from "../log.ts";
import type { Runtime } from "../runtime.ts";

export const PLAN_UI_URI = "ui://off-peak/plan.html";


export interface ToolOutput<T> {
  /** Speakable: ≤ 2 short sentences, decision first, ≤ 1 money figure, 12-hour times, no IDs. */
  text: string;
  data: T;
}

type Out<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

export interface ToolDef<I extends z.ZodRawShape = z.ZodRawShape, O extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  /** Written for routing: what it does plus example phrasings. */
  description: string;
  input: I;
  output: O;
  annotations: Omit<ToolAnnotations, "title">;
  /** Bind the result to the plan timeline MCP App. */
  ui?: boolean;
  run: (args: Out<I>, rt: Runtime) => Promise<ToolOutput<Out<O>>>;
}

export function defineTool<I extends z.ZodRawShape, O extends z.ZodRawShape>(def: ToolDef<I, O>): ToolDef<I, O> {
  return def;
}

export const ERROR_META_KEY = "offpeak/error";

/**
 * Domain errors: speakable text + machine-readable details in `_meta`. Not in `structuredContent`:
 * SDK v1 clients validate structuredContent against the tool's outputSchema even when isError is set
 * (see FRICTION_LOG.md), so an `{ error }` payload would make the client throw instead of speaking.
 */
function errorResult(code: string, message: string, details?: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    _meta: { [ERROR_META_KEY]: { code, message, ...details } },
  };
}

const outputParsers = new WeakMap<ToolDef, z.ZodObject<z.ZodRawShape>>();

/** What to say when the model sends arguments that don't match a tool's input schema. */
const INVALID_INPUT_SPEECH: Record<string, string> = {
  find_rate_plans: "I need a five-digit ZIP code to look up rate plans.",
  select_rate_plan: "Which rate plan should I use? Ask me to find rate plans for your ZIP code first.",
  find_cheapest_window: "Tell me which appliance, or how many minutes of power, and I'll find the cheapest time.",
  plan_tasks: "Tell me which appliances to schedule: the car, the dishwasher, the washer, or the dryer.",
  apply_plan: "I couldn't tell which plan to schedule. Ask me to plan it again.",
  set_mode: "Tell me whether you're heading out, going to bed, back home, or which rooms you're using.",
  arriving: "When will you be home? You can say a time like 9 PM or how many minutes away you are.",
  control_device: "Tell me which device, and whether to turn it on, off, or set it to something.",
  add_rule: "Tell me the rule in a few words, like 'nothing loud after 10'.",
  remove_rule: "Which rule should I remove? Ask me to list your rules if you're not sure.",
  get_savings: "I can tell you what you saved today, this week, or this month.",
};

/**
 * SDK v1 turns input-schema failures into a tool result whose text is the raw validation message
 * ("MCP error -32602: Input validation error: …"), which a speaker would read aloud. There is no public
 * hook to shape it, so we override the server's (TypeScript-private) createToolError on each instance:
 * speakable text for the user, the raw details in `_meta` for developers. See FRICTION_LOG.md.
 */
export function installSpeakableErrors(server: McpServer): void {
  const target = server as unknown as { createToolError?: (message: string) => CallToolResult };
  // If an SDK update renames this private method, keep the SDK's default text rather than failing every call.
  if (typeof target.createToolError !== "function") return;
  const original = target.createToolError.bind(server);
  target.createToolError = (message: string): CallToolResult => {
    const m = /Invalid arguments for tool ([\w-]+)/.exec(message) ?? /Tool ([\w-]+) (?:not found|disabled)/.exec(message);
    if (!m) return original(message);
    const tool = m[1]!;
    const known = /Invalid arguments/.test(message);
    log({ tool, ms: 0, ok: false, code: known ? "invalid_input" : "unknown_tool" });
    const text = known
      ? (INVALID_INPUT_SPEECH[tool] ?? "Sorry, I didn't catch the details for that. Could you say it another way?")
      : "Sorry, Off-Peak can't do that yet.";
    return errorResult(known ? "invalid_input" : "unknown_tool", text, { detail: message });
  };
}

export function registerTool(server: McpServer, rt: Runtime, def: ToolDef): void {
  if (!outputParsers.has(def)) outputParsers.set(def, zod.object(def.output));
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.input,
      outputSchema: def.output,
      annotations: { title: def.title, ...def.annotations },
      _meta: def.ui ? { ui: { resourceUri: PLAN_UI_URI }, [RESOURCE_URI_META_KEY]: PLAN_UI_URI } : undefined,
    },
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const started = performance.now();
      const ms = () => Math.round(performance.now() - started);
      try {
        const { text, data } = await def.run(args as Out<z.ZodRawShape>, rt);
        // Generated output schemas are closed (additionalProperties: false); strip anything extra.
        const parsed = outputParsers.get(def)!.safeParse(data);
        if (!parsed.success) {
          logError(`tool.${def.name}.output`, parsed.error);
          log({ tool: def.name, ms: ms(), ok: false, code: "output_schema" });
          return errorResult("internal", "Sorry, Off-Peak hit a problem with that. Please try again in a moment.");
        }
        log({ tool: def.name, ms: ms(), ok: true });
        // One place turns display notation ("24¢/kWh", "9.6 kW", "10 PM–7 AM") into spoken words.
        return { content: [{ type: "text", text: speakable(text) }], structuredContent: parsed.data as Record<string, unknown> };
      } catch (err) {
        if (err instanceof OffPeakError) {
          log({ tool: def.name, ms: ms(), ok: false, code: err.code });
          return errorResult(err.code, speakable(err.message), err.details);
        }
        log({ tool: def.name, ms: ms(), ok: false, code: "internal" });
        logError(`tool.${def.name}`, err);
        return errorResult("internal", "Sorry, Off-Peak hit a problem with that. Please try again in a moment.");
      }
    },
  );
}
