# Decisions

One line per decision, newest at the bottom of each section.

## Platform & tooling
- 2026-10-19 · MCP SDK pinned to `@modelcontextprotocol/sdk@1.32.1` (v1.x; `LATEST_PROTOCOL_VERSION = "2025-11-25"`). No v2 split packages anywhere in the tree.
- 2026-10-19 · `@modelcontextprotocol/ext-apps` pinned to **1.7.5**: 2.x peers on the v2 SDK packages (`@modelcontextprotocol/server|client|core`), which target protocol 2026-07-28.
- 2026-10-19 · TypeScript pinned to **6.0.3**, not `latest` (7.0, the native port): typescript-eslint and other compiler-API tools cap at `<6.1`.
- 2026-10-19 · No `tsx`: Node ≥ 22.18 strips types natively. Code uses explicit `.ts` import extensions + `erasableSyntaxOnly` (no enums / parameter properties).
- 2026-10-19 · No `concurrently` / `cors` / `eslint` dependencies: `scripts/dev.mjs` (zero-dep runner), a 15-line CORS middleware, and `npm run lint` = strict `tsc` typecheck across workspaces.
- 2026-10-19 · MCP Inspector for local testing is `@modelcontextprotocol/inspector@0.22.0` (last v1-SDK build, simple `--cli` flags); v2 (`mcpdo`) also works and reports era "legacy (2025-11-25)".

## Server
- 2026-10-19 · Stateless Streamable HTTP: new `McpServer` + `StreamableHTTPServerTransport` per POST, `sessionIdGenerator: undefined`, `enableJsonResponse: true`; GET/DELETE `/mcp` → 405. State lives in the Store.
- 2026-10-19 · DNS-rebinding protection: SDK `hostHeaderValidation` on `/mcp` for localhost hostnames; disabled on Lambda (Function URL host varies) unless `MCP_ALLOWED_HOSTS` is set.
- 2026-10-19 · SimClock starts **paused** at the most recent weekday 5:30 PM in the household timezone (override with `SIM_START`), default speed 60× (1 real second = 1 sim minute).
- 2026-10-19 · Tool text obeys the speech contract: ≤ 2 sentences, decision first, ≤ 1 money/price figure, 12-hour times, "demo rate" when on `DEMO_TOU`.
- 2026-10-19 · Domain errors: `isError: true` + speakable text + `_meta["offpeak/error"]` (not `structuredContent.error`; SDK clients would reject it — FRICTION_LOG).
- 2026-10-19 · The tool wrapper parses every `structuredContent` through its Zod output shape (strips extras; generated schemas are closed).
- 2026-10-19 · Every mutation (tool calls, clock ticks, sim admin) runs through one async lock in the runtime; ticks run due jobs "as of" each job's own time, so time travel replays in order.

## Tariffs
- 2026-10-19 · Bundled 3 real trimmed OpenEI responses (PG&E E-TOU-C Region X, PG&E EV2, SCE TOU-D-4-9PM), fetched with NREL's `DEMO_KEY`. `TARIFF_SOURCE=demo|fixture` both offer them offline; `demo` defaults the household to `DEMO_TOU`, `fixture` to E-TOU-C.
- 2026-10-19 · `TARIFF_SOURCE=openei` uses `OPENEI_API_KEY`, defaulting to `DEMO_KEY`; any OpenEI error falls back to bundled plans with a spoken note.
- 2026-10-19 · OpenEI queries add `orderby=startdate&direction=desc`; we keep the newest version per (utility, name).
- 2026-10-19 · Period names come from price levels within each month; a period index reused across seasons with a different rank is split into separate periods (same price) so each month names its own peak.

## Planner & world
- 2026-10-19 · Seed home: 20 devices, 6 rooms + a shared "Whole home" zone (thermostat, water heater, router, aquarium) that is never set back in zone mode.
- 2026-10-19 · "tonight" = done before 7 AM next morning (laundry is then forced before 10 PM by quiet hours; the dishwasher can go overnight). A bare hour ("9") means whichever of 9 AM / 9 PM comes next.
- 2026-10-19 · A dryer in the same request as a washer automatically runs after it; washer→dryer pairs are placed jointly (cheapest pair, not cheapest washer first).
- 2026-10-19 · EV charging is split into steps wherever the charge power changes (load headroom), so per-step kW is exact.
- 2026-10-19 · Shift savings are attributed per executed step (task baseline − task plan cost, by kWh share), so the ledger fills in as the night runs.
- 2026-10-19 · Estimated savings (excluded from headline unless `includeEstimates`): cooling setback 0.05 kWh per °F per hour (≈3%/°F of a 3.5 kW AC at ~50% duty); water heater eco 0.1 kWh/h. Idle/away savings use the device's measured draw before it was switched off × slot price until it came back on.
- 2026-10-19 · Washer cycle is 90 min (spec seed says 60) so Scene 2 at 6:45 PM has a running washer that away mode must not interrupt; golden-scenario costs and savings are unchanged ($7.74).
