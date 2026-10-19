# OffPeak console redesign — October 19, 2026

Reference: [AWS Management Console](https://aws.amazon.com/console/). The implementation keeps React, Vite, the existing MCP client and conversation loop, all 17 server tools, and the shared timeline renderer. It introduces navy console navigation, a light workspace, household metrics, restrained blue selection states, and orange primary actions. All eight demo phrases, microphone/text input, voice/mute, mock/scripted routing, Echo Show/voice-only, MCP App/native screens, occupancy, clock controls, ledger, and inspector remain accessible.

## REA inspection

[morluto/rea](https://github.com/morluto/rea) was run against the actual UI source directory:

```powershell
npx -y rea-agents@latest analyze-javascript-application C:\Users\patri\AWS-Alexa-Hackathon\packages\web\src --format json
```

REA parsed 10 files (59,166 text bytes, 9,623 AST nodes) with zero parse failures and no skipped JavaScript files. Its graph coverage is explicitly partial: static analysis does not demonstrate runtime execution. The initial minified-bundle analysis exhausted REA's analysis-worker heap, so the source analysis is the recorded successful inspection. No REA output is treated as a browser test or a security audit.

## Verification

- Strict TypeScript checks for the five workspaces and the Worker entry point.
- 123 existing Vitest tests pass, covering the deterministic planner, pricing, MCP, protection, undo, conversation, and adapters.
- Four Playwright browser scenarios pass locally and against the public Workers URL: all console controls; the complete evening sequence; fallback/typed input/isolation/persistence; responsive navigation.
- The evening still proposes $7.74 in synthetic savings, preserves protected devices, applies the plan, explains and undoes the TV action, and charges the EV to 80% by the following morning.
- Screenshot files `01-plan.png`, `02-away.png`, `03-savings.png`, and `04-voice-only.png` are captured from the live deployment, in mock mode with the actual MCP App.

Browser tests exercise voice controls and the voice-only display. Actual microphone recognition and audible speech depend on browser permissions/services and are not asserted by these tests.

## Deployment

Live URL: <https://offpeak.patrickvaldivia123.workers.dev>.

The Worker reuses the Express/MCP server through Cloudflare's Node HTTP adapter. A random browser cookie selects an isolated SQLite Durable Object; the existing store interface persists the demo state. A build-only fixtures adapter embeds the same household and tariff files, and the prebuilt MCP App is injected as a resource. Node filesystem loaders and optional AWS adapters remain available in the original server.

The deployment uses Workers Free-compatible resources. No paid-plan upgrade, purchased domain, AWS resource, real-device integration, or model credential is required. Demos expire after inactivity; this is not an authenticated household service.
