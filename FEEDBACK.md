# Tool and SDK feedback

For every tool and SDK we used: what we used it for, what worked, what needs work, the onboarding experience, and whether we'd build with it again. Concrete step-by-step issues are in [FRICTION_LOG.md](FRICTION_LOG.md).

> **TODO(team):** add Bedrock / Lambda / DynamoDB / EventBridge Scheduler / Polly notes after deploying to a real account. During the build there were no AWS credentials, so those sections describe implementation and offline validation only.

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1)
- **Used for:** The MCP server (`McpServer.registerTool` / `registerResource`, `StreamableHTTPServerTransport` in stateless JSON mode) and the browser MCP client in the simulator (`Client` + `StreamableHTTPClientTransport`).
- **What worked:**
  - The v1 server API matched the documented skeleton exactly, and `registerTool` passes `_meta` through, which MCP Apps needs.
  - Stateless mode (`sessionIdGenerator: undefined`, `enableJsonResponse: true`, a new server per request) is simple and Lambda-friendly.
  - Zod 4 raw shapes work directly for input and output schemas.
  - The same client runs unchanged in the browser.
- **Needs work:**
  - The client validates `structuredContent` against `outputSchema` even on `isError` results, while the server skips it. Spec-style error payloads therefore make the client throw.
  - Generated output schemas are closed (`additionalProperties: false`) without that being documented next to `registerTool`.
  - Stateless servers produce a console 405 in browsers on every connect.
  - The v1/v2 split (v2 targets 2026-07-28 with no `initialize`) is easy to install by accident.
- **Onboarding:** Good once you know to pin v1. The protocol-version constant (`LATEST_PROTOCOL_VERSION = "2025-11-25"`) made the version test trivial.
- **Would we use it again?** Yes.

## MCP Inspector (`@modelcontextprotocol/inspector`)
- **Used for:** Verifying every milestone from the CLI (`tools/list`, `tools/call`, `resources/read`) against the local server and the Lambda bundle.
- **What worked:** 0.22's one-shot `--cli … --method tools/call --tool-name … --tool-arg k=v` is ideal for scripts. v2's `mcpdo` connects to 2025-11-25 servers and shows "Era: legacy (2025-11-25)", which is a nice touch.
- **Needs work:**
  - `npx @modelcontextprotocol/inspector` now resolves to v2 with a different CLI.
  - Non-interactive `mcpdo` needs `--connection` on every call.
  - `--tool-arg zip=94110` is coerced to a number regardless of the tool's schema.
- **Onboarding:** Fast with v1; v2 needed reading `--help` twice.
- **Would we use it again?** Yes.

## MCP Apps (`@modelcontextprotocol/ext-apps` 1.7.5)
- **Used for:**
  - The plan timeline View (`App`, `ontoolresult`) as a single-file Vite build.
  - `registerAppResource` and the `RESOURCE_MIME_TYPE` / `RESOURCE_URI_META_KEY` constants on the server.
  - `AppBridge` + `PostMessageTransport` to host the View in our simulator.
- **What worked:** The protocol is small and clear: initialize, tool-input, tool-result, teardown. Rendering purely from `structuredContent` let us reuse the exact same renderer natively as a fallback. `autoResize` and host context work.
- **Needs work:**
  - 2.x silently requires the v2 SDK; a compatibility table would help.
  - In the documented host flow (set the src, then connect), a fast View's `ui/initialize` is lost.
  - `setHostContext()` before `connect()` throws.
  - The View bundle is 460 KB for a tiny UI.
- **Onboarding:** The typed examples (`*.examples.ts`) are excellent; the hosting race cost us about an hour.
- **Would we use it again?** Yes. It's the right abstraction for Echo Show-class screens.

## OpenEI Utility Rate Database (URDB API)
- **Used for:** Live residential tariff lookup by ZIP, and the three real fixtures we bundle (PG&E E-TOU-C, PG&E EV2, SCE TOU-D-4-9PM).
- **What worked:**
  - Rich, real data: 12×24 schedules, tiers, adjustments, fixed charges.
  - `getpage=<label>` for a single rate.
  - NREL's `DEMO_KEY` works for trying it out.
- **Needs work:**
  - Address lookups return stale rates first unless you add `orderby=startdate&direction=desc`.
  - Many superseded versions share a name.
  - The fixed charge moves between `fixedmonthlycharge` and `fixedchargefirstmeter` + units.
  - Period indices get reused across seasons with different meaning.
  - `DEMO_KEY` rate-limits after about ten calls.
- **Onboarding:** The API docs list fields but not their pitfalls; we learned by inspecting responses.
- **Would we use it again?** Yes. Nothing else gives real US tariffs for free. This is also why we publish `tou-rates`.

## Amazon Bedrock (Converse + tool use)
- **Used for:** The simulated Alexa+ reasoning loop (`ConverseCommand` with `toolConfig` built from MCP `tools/list`), and the second-chance rule parser.
- **What worked (offline):** Converse's message and `toolUse`/`toolResult` shapes map cleanly onto MCP tool calls. We kept the browser in charge of MCP and the server only as a model proxy, and built a zero-cost mock with the identical response shape for tests and demos.
- **Needs work:** Model availability for Converse tool use varies by account, region, and inference profile. We added `npm run bedrock:models` to list what's actually callable instead of guessing IDs. Current Claude models reject sampling parameters, so the proxy omits `temperature`.
- **Onboarding:** Not exercised live (no credentials during the build). **TODO(team).**
- **Would we use it again?** Yes, for the AWS-native story.

## AWS Lambda + Lambda Web Adapter, Amazon DynamoDB, Amazon EventBridge Scheduler, AWS CDK
- **Used for:**
  - The MCP server on Lambda behind the Web Adapter (unmodified Express).
  - An executor Lambda for one-time `at()` schedules.
  - A single DynamoDB table.
  - A CDK stack with least-privilege IAM.
- **What worked:**
  - Stateless MCP plus the Web Adapter means no Lambda-specific server code.
  - Vite SSR builds a self-contained Lambda bundle without adding esbuild.
  - EventBridge Scheduler's `at()` + `ScheduleExpressionTimezone` + `ActionAfterCompletion: DELETE` maps 1:1 to "start the dishwasher at midnight, local time".
  - `cdk synth` works offline.
- **Needs work:** The executor needs its own ARN in configuration, which is circular in CloudFormation, so we construct it from the function name. The Web Adapter layer ARN/version has to be looked up by hand.
- **Onboarding:** Adapters are unit-tested with fake clients; `cdk synth` verified. **TODO(team):** deploy, then fill in the real experience.
- **Would we use it again?** Yes.

## Kiro
- Not used for this build.
