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
