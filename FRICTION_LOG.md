# Friction log

Issues we hit with SDKs, docs, and tools while building Off-Peak, logged as they happened.

### ext-apps 2.x silently requires the v2 MCP SDK
- Task attempted: Add `@modelcontextprotocol/ext-apps` (MCP Apps) to a server built on `@modelcontextprotocol/sdk` v1 for protocol 2025-11-25 (what Alexa+ supports).
- Steps taken: `npm view @modelcontextprotocol/ext-apps@latest peerDependencies`.
- Expected: The latest ext-apps works with the SDK that targets the protocol version Alexa+ supports.
- Actual: ext-apps 2.0.x peers on `@modelcontextprotocol/server|client|core@^2`, which target 2026-07-28 (no `initialize` handshake). The README's install line pulls the incompatible major.
- Severity: major
- Workaround: Pin `@modelcontextprotocol/ext-apps@1.7.5` (peers on `@modelcontextprotocol/sdk ^1.29`).
- Suggestion: A compatibility table (ext-apps major ↔ SDK major ↔ protocol version) at the top of the ext-apps README, and a `v1` dist-tag.

### `npx @modelcontextprotocol/inspector` changed CLI between majors
- Task attempted: Verify the server with the Inspector CLI, using the `--cli <url> --transport http --method tools/list` flags from docs and blog posts.
- Steps taken: Ran `npx @modelcontextprotocol/inspector --cli …` (resolves to 2.11.0).
- Expected: The documented flags work.
- Actual: v2 moved scripting to a separate `mcpdo` binary with named connections (`mcpdo connect <url>`, then `--connection <name>` on every call in non-interactive mode). v1 still works but prints four deprecation warnings per run.
- Severity: minor
- Workaround: Pin `@modelcontextprotocol/inspector@0.22.0` for the one-liner; v2 `mcpdo` also connects and reports "Era: legacy (2025-11-25)".
- Suggestion: Keep a one-shot `--cli` compatibility mode in v2, and mention in the deprecation warning which flags map to which `mcpdo` commands.

### TypeScript `latest` is the 7.0 native port
- Task attempted: Pick a TypeScript version for a strict ESM monorepo.
- Steps taken: `npm view typescript dist-tags` → `latest: 7.0.2`; `npm view typescript-eslint peerDependencies` → `typescript <6.1.0`.
- Expected: `latest` works with the ecosystem's standard lint tooling.
- Actual: Compiler-API tools aren't compatible with 7.0 yet.
- Severity: minor
- Workaround: Pin `typescript@6.0.3`.
- Suggestion: n/a (ecosystem transition); worth a note in MCP SDK templates that pin TS.

### SDK v1 client validates `structuredContent` against `outputSchema` even on `isError` results
- Task attempted: Return speakable domain errors as `isError: true` with machine-readable details in `structuredContent.error` from tools that declare an `outputSchema`.
- Steps taken: Server returned `{ isError: true, content: [...], structuredContent: { error } }`; called it from `Client.callTool` (SDK 1.32.1).
- Expected: The client skips output validation for error results. The comment in `client/index.js` says so ("Only validate structured content if present (not when there's an error)"), and the server-side `McpServer.validateToolOutput` does skip `isError` results.
- Actual: The client validates any present `structuredContent` and throws `McpError -32602: Structured content does not match the tool's output schema`, so the user never hears the speakable error.
- Severity: major
- Workaround: Errors carry only `content` text + `isError`, with details in `_meta["offpeak/error"]`.
- Suggestion: Make the client match the server (skip validation when `isError`), or document that error results must also satisfy the output schema; clarify this in the spec text for `outputSchema`.

### Zod → JSON Schema output schemas are closed (`additionalProperties: false`)
- Task attempted: Return domain objects (plans, ledger entries) as `structuredContent`.
- Steps taken: Declared `outputSchema` as a Zod raw shape; returned objects with a few extra internal fields.
- Expected: Extra fields are tolerated or stripped.
- Actual: The generated JSON Schema sets `additionalProperties: false` at every level, so SDK clients reject the whole result.
- Severity: minor
- Workaround: Our tool wrapper parses every result through `z.object(outputShape)` (which strips unknown keys) before returning.
- Suggestion: Strip unknown keys server-side in `McpServer` before validating, or document the closed-object behavior next to `registerTool`.

### MCP Inspector CLI coerces `--tool-arg zip=94110` to a number
- Task attempted: Call `find_rate_plans` from the Inspector CLI with a ZIP code.
- Steps taken: `--method tools/call --tool-name find_rate_plans --tool-arg zip=94110`.
- Expected: A string argument (the schema says `type: string`).
- Actual: The CLI JSON-parses the value and sends `94110` (number); input validation fails.
- Severity: minor
- Workaround: The tool accepts a string or a number and normalizes to a 5-digit string (LLMs do the same thing).
- Suggestion: Coerce `--tool-arg` values using the tool's `inputSchema` types.

### OpenEI URDB: address lookups return stale rates first
- Task attempted: Find current residential TOU rates for a ZIP (`address=<zip>&limit=50`).
- Steps taken: Queried 92614 (SCE territory) and 94110.
- Expected: Current tariffs first.
- Actual: 2016 tariffs with no `enddate` came back first and filled the page; current ones were missing. ZIP 94110 resolved only to the SF municipal utility. Fixed charges came as `fixedchargefirstmeter` in `$/day`, not `fixedmonthlycharge`. Period indices are sometimes reused across seasons with different relative prices.
- Severity: major
- Workaround: `orderby=startdate&direction=desc`, keep only the newest version per (utility, name), convert `$/day`/`$/year` fixed charges, and split re-used period indices per season when naming periods.
- Suggestion: Default ordering by `startdate desc` and a `current=true` filter; one documented fixed-charge field.

### OpenEI `DEMO_KEY` works but rate-limits quickly
- Task attempted: Fetch real fixtures and test live lookups without signing up for a key.
- Steps taken: Used `api_key=DEMO_KEY` (NREL convention).
- Expected: Unclear; not documented on the OpenEI API page.
- Actual: It works, then returns `OVER_RATE_LIMIT` after roughly ten calls in an hour.
- Severity: minor
- Workaround: Bundled three trimmed real responses in `fixtures/tariffs/`; the live adapter falls back to them on any error.
- Suggestion: Document `DEMO_KEY` and its limits on the URDB API page.

### MCP Apps: View's `ui/initialize` can be lost if the host connects on iframe `load`
- Task attempted: Host `ui://off-peak/plan.html` (single-file Vite build) in an iframe with ext-apps' `AppBridge`, following the documented flow (set the iframe source, then `bridge.connect(new PostMessageTransport(...))`).
- Steps taken: Set `iframe.srcdoc`, connected the bridge in the iframe's `load` handler.
- Expected: `bridge.oninitialized` fires.
- Actual: It never fired. The inlined app parses and sends `ui/initialize` before `load`, so the host wasn't listening yet and the request was dropped; no retry. Our host fell back to native rendering after 4 s.
- Severity: major
- Workaround: Create and `connect()` the AppBridge to `iframe.contentWindow` first, then set `srcdoc` (the WindowProxy stays the same across the navigation).
- Suggestion: Document "connect before loading the View" in the AppBridge example, or have `App.connect()` retry `ui/initialize` until answered.

### MCP Apps: `AppBridge.setHostContext()` before `connect()` throws "Not connected"
- Task attempted: Give the View an initial theme/display mode.
- Steps taken: `bridge.setHostContext({...})` right after `new AppBridge(...)`.
- Expected: Context is stored and delivered in the `ui/initialize` result.
- Actual: It immediately sends `ui/notifications/host-context-changed`, which rejects with an unhandled "Not connected".
- Severity: minor
- Workaround: Pass `{ hostContext }` as the 4th constructor argument (`HostOptions`).
- Suggestion: Make `setHostContext` buffer until connected, or say so in its doc comment.

### MCP Apps bundle size for a tiny View
- Task attempted: Single-file MCP App (one timeline view, vanilla DOM).
- Actual: 460 KB (113 KB gzip) because `App` pulls in the SDK's `Protocol` and Zod. Fine on a laptop; heavy for an Echo Show-class device.
- Severity: minor
- Suggestion: A slim postMessage-only View client (no Zod validation) for constrained hosts.

### Stateless Streamable HTTP: browser console shows a 405 on every connect
- Task attempted: Browser MCP client against a stateless server (`sessionIdGenerator: undefined`).
- Actual: After `initialize`, the SDK client opens the optional standalone GET SSE stream; the server answers 405 (correct per spec) and the SDK handles it, but Chrome logs "Failed to load resource: 405" on every page load, which looks like a bug during a demo.
- Severity: minor
- Workaround: None needed; documented in the README.
- Suggestion: Let clients skip the standalone GET when the server signals statelessness (e.g. no `mcp-session-id`), or an option to disable it.
