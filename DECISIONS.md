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

## Web client & LLM
- 2026-10-19 · `BEDROCK_MODEL_ID` ships empty: no AWS credentials were available to verify which models this account/region can call through Converse. `npm run bedrock:models` lists ACTIVE models + inference profiles; the team picks one with Converse tool use and records it here. Until then Bedrock mode returns a speakable "set BEDROCK_MODEL_ID" error. **TODO(team): record the chosen model ID.**
- 2026-10-19 · The Converse call sends no `temperature`/`topP` (current Claude models reject sampling parameters); `maxTokens: 1024`.
- 2026-10-19 · System prompt is the SPEC §12 text verbatim as the first system block; a second block carries the sim-clock local time so "tonight" / "by 7" resolve against the simulated home, not the laptop clock.
- 2026-10-19 · `LLM_MODE=mock` and `?mode=scripted` share one regex intent router (`core/intents.ts`), so the mock LLM and the scripted fallback behave identically on the demo lines.
- 2026-10-19 · Tool results go back to the model as text + JSON with the `timeline` stripped (screens need it; the model doesn't).
- 2026-10-19 · Speech never blocks the next turn; a new utterance interrupts it. Polly is used only when `POLLY_VOICE` is set, else `speechSynthesis`.
- 2026-10-19 · After a turn with no UI-bound tool result, the host refreshes the Echo Show with `get_home_status` (what a real screen device would show).
- 2026-10-19 · The MCP App is hosted with ext-apps' `AppBridge` in a `sandbox="allow-scripts"` srcdoc iframe; on any failure within 4 s the web client renders the same view natively from `structuredContent` (shared renderer in `packages/ui-apps/src/timeline.ts`).

## Console and public demo
- 2026-10-19 · Extend the existing AWS-style console with a guided seven-scene walkthrough, explicit approval, labeled task-cost comparison, visible household rules, a readable presentation view, and downloadable observations. Keep all 17 tools and original controls.
- 2026-10-19 · A proposed plan must still match its approval context: reject unresolved conflicts, superseded proposals, changed rules/tariffs, and starts over one minute in the past. Applied plans remain idempotent.
- 2026-10-19 · Publish the independently tested MIT tariff library at `Darthh/tou-rates`. The optional new CI workflow was omitted because the existing OAuth login lacks workflow scope; the parent CI validates the export.
- 2026-10-19 · Self-host Public Sans with its OFL license and record real browser actions with English captions. Separate the public MCP/Cloudflare demo from unverified live AWS/Echo operation and the team's remaining Devpost/video declarations.
- 2026-10-19 · Use the AWS console as the UI reference while retaining React/Vite, every existing control, the conversation loop, and the shared MCP App/native renderer.
- 2026-10-19 · Host the no-key demo on `offpeak.patrickvaldivia123.workers.dev`. Reuse the Express/MCP server via the Workers Node HTTP adapter; isolate and persist each browser's simulated household in a SQLite Durable Object. Keep the original Node/AWS integrations intact.
- 2026-10-19 · The Worker build embeds fixtures and screen HTML and always uses same-origin APIs. It never reads AWS/model/device credentials from local deployment configuration. Browser tests and live screenshots cover the public demo; AWS/Echo operation remains a separate boundary.

## AWS deploy & open source
- 2026-10-19 · Lambda bundle is built with Vite SSR (`vite.lambda.config.ts`, `noExternal: true`) instead of adding esbuild for CDK `NodejsFunction`; CDK uses `Code.fromAsset(dist-lambda)`.
- 2026-10-19 · MCP server on Lambda runs the unmodified Express app behind the AWS Lambda Web Adapter layer (`run.sh` → `node main.mjs`, port 8080). The layer version is a CDK context value (`lambdaWebAdapterLayerVersion`, default 25 — verify before deploy).
- 2026-10-19 · The executor's ARN is constructed from a fixed function name (`offpeak-executor`) so both Lambdas can carry `EXECUTOR_LAMBDA_ARN` without a CloudFormation cycle.
- 2026-10-19 · Function URL auth is `NONE` for the hackathon demo (multi-household auth is in BACKLOG); the README says to `cdk destroy` after testing. Sim admin routes are off in the cloud (`SIM_ADMIN=0`).
- 2026-10-19 · `tou-rates` is exported to a standalone repo by `scripts/export-tou-rates.mjs` (rewrites package.json to `dist/`, copies fixtures, fixes test paths); verified: install + 21 tests + build. Publishing the public GitHub repo is a team action.

## Pre-submission refinements (October 21)
- 2026-10-21 · Device matching only tolerates typos in words of 4+ letters that aren't device-kind words. "tv" no longer becomes the car ("ev") and "light" no longer becomes the bedside "night light"; ambiguous kinds ask a question. Asking to schedule a device that isn't schedulable says which appliances can be planned.
- 2026-10-21 · All tool text passes through one `speakable()` step: "24¢/kWh" → "24 cents a kilowatt-hour", "9.6 kW" → "9.6 kilowatts", "15 W" → "15 watts", "68–78°F" → "68 to 78 degrees", en-dash ranges → "to". Amounts under a dollar are spoken in cents. Display strings (ledger, plan steps) keep their compact notation.
- 2026-10-21 · Input-schema failures are spoken too: the instance's (TS-private) `createToolError` is overridden after tool registration; the raw SDK message stays in `_meta`. Malformed JSON on `/mcp` returns JSON-RPC −32700 instead of a 500.
- 2026-10-21 · Conflicts offer 2–3 ways forward, priced against the cheapest possible run: relax the blocking rule first (rules are the user's call), then the earliest finish that works and the cheapest later finish, then a lower charge target or the load cap. Times on a later day say "tomorrow". A task blocked by its predecessor inherits the rule-relaxing options.
- 2026-10-21 · Pre-cooling never starts inside peak, including when the 30-minute window only clips the start of peak (e.g. home at 4:15 PM → cooling starts at 4:15 PM, not 3:45 PM). The ledger reason for pre-cooling is a proper because-clause.
- 2026-10-21 · Zone mode sets back a thermostat or water heater only when the zone it serves is inactive (spec §9); in the seed both are whole-home, so the demo is unchanged.
- 2026-10-21 · "Today" savings count the whole plan when any of its steps ran today, so at 7 AM "How much did Off-Peak save me today?" matches the $7.74 the plan promised the evening before (the reply says it counts the overnight schedule). Idle/away savings still reset at local midnight. The guided walkthrough asks for today instead of the week.
- 2026-10-21 · Rules > presence in speech: when away mode holds back an ask-first device, the reply asks about it instead of the arrival note (the arrival time is still scheduled and in `structuredContent`).
- 2026-10-21 · `undo` takes an optional `device` so "turn it back on" after an explanation reverses only that device, not the whole away-mode group. `explain` offers "Want me to turn it back on?" for things it turned off.
- 2026-10-21 · New rule phrasing: "never/don't run the dryer after 9 PM" becomes a dryer finish deadline. `remove_rule` matches the words people use ("the load limit", "quiet hours", a device name); `list_rules` speaks every rule it counts.
- 2026-10-21 · The tariff library's TOU ranking now uses the same test as `normalize().isTou` (more than one distinct *price* in a day), so two periods with the same price rank as flat.
- 2026-10-21 · Echo Show screen: the console keeps the requested AWS-style design, but the simulated device is now a dark 16:10 Echo Show with a cyan accent, authored at the device's 960×600 logical size and scaled to fit (phone, console, or Large screen). Captions (Alexa's reply) render on the screen as Echo Show does, at ≥ 24 px; the voice-only mode keeps the Echo Dot ring with captions below. The MCP App gets host theme `dark`; every timeline text size is ≥ 24 px at device size. The compact layout for narrower hosts now uses container queries.
- 2026-10-21 · The header badge always shows the negotiated protocol and transport ("MCP 2025-11-25 · Streamable HTTP · 17 tools") so judges don't have to open the Inspector tab to see it.
- 2026-10-21 · `.env` is optional: the server loads it in code (`src/env.ts`) instead of `node --env-file-if-exists`, which crashes Node 22 watch mode when the file is missing (FRICTION_LOG).
- 2026-10-21 · The washer stays at 90 minutes (recorded earlier) so it is still running at 6:45 PM; the spec's 60 minutes would let it finish before the away scene.
- 2026-10-21 · After an independent review of the above: a later-finish option for a washer→dryer pair covers the whole chain (washer 7–8:30 AM, dryer until 9:30 AM), so accepting it plans instead of repeating the offer; device matching treats a swapped pair of letters as one typo and plurals as their singular ("wahser", "tvs"); `speakable()` only turns *numeric and clock* en-dash ranges into "to", never names; savings for any period include the whole plan once one of its steps ran in it, so "today" can't exceed "this week"; "don't start the dryer until after 10" and car phrasings are not captured by the "never run X after T" rule; a thermostat alias that is also a rule word ("temperature") selects the comfort rule.
