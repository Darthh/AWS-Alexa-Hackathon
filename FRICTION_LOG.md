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


### Windows npm.cmd process creation fails with EINVAL
- Task attempted: Run the one-command local demo on Windows with Node 24.
- Steps taken: Reproduced `spawnSync("npm.cmd", ["--version"])`; started the original process model and inspected the launcher.
- Expected: npm reports a version and child workspace commands start.
- Actual: Direct process creation returns EINVAL. The corrected `npm run dev` starts both Vite on 5173 and the MCP server on 8787.
- Severity: major
- Workaround: Invoke `process.execPath` with `process.env.npm_execpath` and workspace arguments. Stop only the spawned process tree on Windows.
- Suggestion: Cross-platform examples should use the npm JS entry point rather than assuming .cmd launch behavior matches a POSIX executable.

### File URL pathname is not a native Windows path
- Task attempted: Export tou-rates as an independent repository.
- Steps taken: Inspected `new URL("..", import.meta.url).pathname` in the existing export script and compared it with `fileURLToPath`.
- Expected: The repository root resolves correctly on Windows and Linux.
- Actual: URL pathnames include a leading slash before a Windows drive letter. The corrected export installed, passed 21 tests and built independently on Windows.
- Severity: major
- Workaround: Convert the file URL with `fileURLToPath`; constrain generated output to the dedicated export workspace.
- Suggestion: Node examples that derive paths from import.meta.url should demonstrate the URL conversion API explicitly.

### Lambda packaging duplicated the Windows drive letter
- Task attempted: Build the optional AWS Lambda deployment artifacts on Windows.
- Steps taken: Ran `npm run build:lambda`; Vite bundled the server/executor, then the asset-copy script ran.
- Expected: Fixtures and the MCP App are packaged beside the Lambda entry points.
- Actual: The copy script tried to read `C:\C:\Users\...\fixtures` and failed with ENOENT.
- Severity: major
- Workaround: Convert both file URLs with `fileURLToPath`. The corrected packager copied fixtures, the screen and run.sh; CDK synthesis also passed locally.
- Suggestion: Packaging examples should test file-URL conversion on Windows in addition to POSIX hosts.

### GitHub OAuth lacks workflow write scope
- Task attempted: Publish the independently tested MIT tariff library with an optional new CI workflow.
- Steps taken: Created the public repository and pushed the initial commit.
- Expected: The source, license and workflow are accepted together.
- Actual: GitHub rejected the workflow file because the current OAuth app lacks workflow scope.
- Severity: minor
- Workaround: Removed the optional workflow before the first successful push. OffPeak's existing CI tests the exported library; no account permission expansion was needed.
- Suggestion: CLI repository creation could report workflow-scope readiness before attempting a source push.

### Hosted demo inherited a localhost API override
- Task attempted: Build the hosted console from a normal developer environment.
- Steps taken: Built with VITE_MCP_URL=http://localhost:8787/mcp, then checked the generated Worker web bundle.
- Expected: A Workers deployment uses its own /mcp and companion routes.
- Actual: Normal Vite environment replacement can retain a local override. Explicit Worker build mode now omits that override; the bundled client resolves its current origin.
- Severity: major
- Workaround: A dedicated Vite worker mode and a build check; live browser tests use the deployed same-origin endpoint.
- Suggestion: Deployment templates should separate development endpoint overrides from hosted defaults.

### SDK v1 speaks raw input-validation errors, with no public hook to change them
- Task attempted: Keep every tool reply speakable on a voice device, including when the model sends arguments that fail the tool's input schema (for example `find_rate_plans` with `zip: "abc"`).
- Steps taken: Called the tool over Streamable HTTP with bad arguments and read the `CallToolResult` the SDK returned; looked for a hook in `McpServer` (`registerTool` options, server options, error callbacks).
- Expected: A way to shape validation failures (or at least a structured error code) so a host can say something sensible.
- Actual: `McpServer` validates input before our handler runs and returns `isError: true` with the text `MCP error -32602: Input validation error: Invalid arguments for tool find_rate_plans: Invalid string: must match pattern /^\d{5}$/ at zip`. A speaker would read that aloud. The method that builds it (`createToolError`) is TypeScript-private, and no structured error code is attached.
- Severity: major (for voice-first hosts such as Alexa+)
- Workaround: Override the instance's `createToolError` right after registering tools: map the tool name to a short spoken prompt ("I need a five-digit ZIP code to look up rate plans."), keep the raw message in `_meta`, and log `{ tool, ok: false, code: "invalid_input" }`. Covered by `packages/server/test/refinements.test.ts`.
- Suggestion: A public `onToolInputError(tool, issues) => CallToolResult` option on `McpServer` (or `registerTool`), and a machine-readable code on the default error result.

### Node 22 `--watch` crashes when `--env-file-if-exists` points at a missing file
- Task attempted: Run `npm run dev` on a fresh clone without copying `.env.example` (the "zero keys, one command" path judges are likely to take).
- Steps taken: `git clone … && npm ci && npm run dev` on Node 22.22.
- Expected: `--env-file-if-exists` skips the missing file, as its name says.
- Actual: The server process exits with `ENOENT: no such file or directory, watch '/…/.env'` from Node's watch-mode file watcher, which tries to watch the env file even though it doesn't exist. The web client starts but shows "MCP offline". It never showed up for us locally because we all had a `.env`.
- Severity: major (breaks the documented quick start)
- Workaround: Drop the flag; load the repo-root `.env` in code (`packages/server/src/env.ts`, `util.parseEnv`, existing variables win) as the first import of `main.ts`.
- Suggestion: Node: don't add a missing `--env-file-if-exists` file to the watch list. Projects: test the quick start from a clean clone in CI.

### Viewport media queries behave differently in the MCP App iframe and in the native fallback
- Task attempted: Render the plan timeline at Echo Show size (a 960×600 screen, type ≥ 24 px) both as the MCP App iframe and natively in the console when the iframe is unavailable.
- Steps taken: Put the shared renderer inside a scaled 960×600 device canvas and opened the console on a 390 px phone.
- Expected: Both paths look the same, since both render into a 960 px-wide screen.
- Actual: Inside the iframe, `@media (max-width: 850px)` saw the iframe's 960 px viewport. In the native path it saw the 390 px browser window and switched to the compact layout (8–15 px type) inside the device screen.
- Severity: minor
- Workaround: Use container queries (`container-type: inline-size` on the iframe `body` and on the console's screen body) so the compact rules key off the box the app is rendered into.
- Suggestion: MCP Apps examples for embeddable views could use container queries by default, since a View can't know whether it is in an iframe or rendered inline.

### Playwright video capture requires its own FFmpeg build
- Task attempted: Record the captioned demo video (`npm run record:demo`) in a network-restricted environment.
- Steps taken: Pointed Playwright at an existing Chromium build; system FFmpeg (with libvpx) was already installed.
- Expected: Video recording uses the installed FFmpeg or reports how to point at one.
- Actual: `newPage` fails with "Executable doesn't exist at …/ffmpeg-1013/ffmpeg-linux" and only suggests `npx playwright install ffmpeg`, which needs the Playwright CDN.
- Severity: minor
- Workaround: `PW_CHROMIUM_PATH` selects any Chromium for tests and the recorder; for video, place a link to the system `ffmpeg` at the expected path under `PLAYWRIGHT_BROWSERS_PATH`.
- Suggestion: An environment variable for the FFmpeg path, matching `executablePath` for browsers.
