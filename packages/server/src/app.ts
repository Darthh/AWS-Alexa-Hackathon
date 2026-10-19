import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { logError } from "./log.ts";
import { buildServer } from "./mcp/server.ts";
import type { Runtime } from "./runtime.ts";
import { simRouter } from "./sim/routes.ts";

const ALLOW_HEADERS = "content-type, accept, mcp-protocol-version, mcp-session-id, authorization, last-event-id";
const EXPOSE_HEADERS = "mcp-session-id";

/** CORS limited to WEB_ORIGIN (no wildcard). */
function cors(origin: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.origin === origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
      res.setHeader("Access-Control-Expose-Headers", EXPOSE_HEADERS);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

function methodNotAllowed(_req: Request, res: Response) {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: POST only)." }, id: null });
}

export function createApp(rt: Runtime) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors(rt.config.webOrigin));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: "off-peak", clock: rt.clock.state() });
  });

  const mcpGuards = rt.config.allowedHosts.length ? [hostHeaderValidation(rt.config.allowedHosts)] : [];

  app.post("/mcp", ...mcpGuards, express.json({ limit: "1mb" }), async (req, res) => {
    // Stateless: a new server + transport per request; never share one across concurrent requests.
    const server = buildServer(rt);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logError("mcp", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  if (rt.config.simAdmin) app.use("/sim", simRouter(rt));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logError("http", err);
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  });

  return app;
}
