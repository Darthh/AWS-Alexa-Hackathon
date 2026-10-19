import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import { DateTime } from "luxon";
import type { Runtime } from "../runtime.ts";
import { PLAN_UI_URI } from "./defineTool.ts";

export const MCP_APP_MIME = RESOURCE_MIME_TYPE; // "text/html;profile=mcp-app"

const FALLBACK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Off-Peak plan</title></head>
<body style="font:24px system-ui;background:#0b1220;color:#e6f1ff;padding:24px">
Plan timeline not built yet. Run <code>npm run build -w @off-peak/ui-apps</code>.</body></html>`;

let cached: { html: string; mtime: number } | null = null;

/** The single-file MCP App built by packages/ui-apps (re-read when the build changes). */
export function planAppHtml(): string {
  const file = process.env.PLAN_APP_HTML ?? fileURLToPath(new URL("../../../ui-apps/dist/plan.html", import.meta.url));
  if (!existsSync(file)) return FALLBACK_HTML;
  try {
    const html = readFileSync(file, "utf8");
    cached = { html, mtime: Date.now() };
    return html;
  } catch {
    return cached?.html ?? FALLBACK_HTML;
  }
}

export function registerResources(server: McpServer, rt: Runtime): void {
  server.registerResource(
    "tariff-current",
    "offpeak://tariff/current",
    { title: "Current rate plan", description: "The household's normalized time-of-use tariff", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await rt.currentTariff(), null, 2) }] }),
  );
  server.registerResource(
    "household",
    "offpeak://household",
    { title: "Household", description: "Zones, devices, rules, and mode", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await rt.household(), null, 2) }] }),
  );
  server.registerResource(
    "ledger-today",
    "offpeak://ledger/today",
    { title: "Today's actions", description: "Everything Off-Peak did today, with reasons and savings", mimeType: "application/json" },
    async (uri) => {
      const since = DateTime.fromJSDate(rt.clock.now(), { zone: rt.timezone }).startOf("day").toISO()!;
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await rt.store.listLedger({ since }), null, 2) }] };
    },
  );
  registerAppResource(
    server,
    "plan-timeline-app",
    PLAN_UI_URI,
    {
      title: "Plan timeline",
      description: "Echo Show plan timeline (MCP App) for plan_tasks, get_home_status, and get_savings",
      mimeType: MCP_APP_MIME,
      _meta: { ui: { prefersBorder: false } },
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text: planAppHtml() }] }),
  );
}
