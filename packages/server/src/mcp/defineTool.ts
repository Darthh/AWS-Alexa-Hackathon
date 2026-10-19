import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { OffPeakError } from "@off-peak/core";
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
      _meta: def.ui ? { ui: { resourceUri: PLAN_UI_URI }, "ui/resourceUri": PLAN_UI_URI } : undefined,
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
        return { content: [{ type: "text", text }], structuredContent: parsed.data as Record<string, unknown> };
      } catch (err) {
        if (err instanceof OffPeakError) {
          log({ tool: def.name, ms: ms(), ok: false, code: err.code });
          return errorResult(err.code, err.message, err.details);
        }
        log({ tool: def.name, ms: ms(), ok: false, code: "internal" });
        logError(`tool.${def.name}`, err);
        return errorResult("internal", "Sorry, Off-Peak hit a problem with that. Please try again in a moment.");
      }
    },
  );
}
