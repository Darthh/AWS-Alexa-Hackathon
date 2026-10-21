# OffPeak — Devpost submission text

**Tagline:** Cut my power bill without wrecking my evening.

**Primary track:** Alexa+ — a self-hosted MCP server and a browser-based Alexa+ simulator.

**Live demo:** <https://offpeak.patrickvaldivia123.workers.dev>

**Source:** <https://github.com/Darthh/AWS-Alexa-Hackathon> · MIT.

**Open Source contribution:** <https://github.com/Darthh/tou-rates> · MIT. Verified contributor: `Darthh`; confirm any additional team usernames before submitting.

**Video:** Paste the public YouTube/Vimeo link after uploading the recording. `out/offpeak-demo.mp4` (113 seconds, 1600×1000, English captions, no audio) was captured on October 21 from the current build in mock mode; say so in the description. No live Bedrock model has been validated for this submission.

## Inspiration

A cheap schedule is useless if the car is not charged by 7 AM or the dryer wakes the household. We wanted an energy assistant that can explain a lower-cost evening, ask for approval, and keep the household's promises.

The target customer is a household with time-of-use electricity pricing and flexible loads such as an EV, dishwasher and laundry. The opportunity is coordinating those loads around deadlines, quiet hours and shared electrical capacity through one conversation.

## What it does

Ask: “I need the car charged by 7, dishes and laundry done tonight, nothing loud after 10.” OffPeak proposes the washer now, dryer at 9 PM, and dishwasher and car overnight. It shows the timeline, task costs, deadlines, quiet hours and load checks before anything runs.

In the seeded weekday scenario, the run-now task-energy baseline is **$17.31**, the proposed task cost is **$9.57**, and the modeled difference is **$7.74**. These numbers use a clearly labeled synthetic demo tariff, not a measured utility bill or a forecast of yearly savings. Fixed charges, demand charges and other whole-bill components are outside this calculation.

After explicit approval, a deterministic scheduler executes the plan. Away and one-room modes reduce simulated standby loads while protecting the fridge, Wi-Fi router, aquarium and running cycles. “Why did the TV turn off?” reads the recorded reason; “Turn it back on” restores the previous state.

The guided walkthrough makes that sequence easy to review. The Inspector shows actual MCP messages, and a downloadable demo receipt includes observed protocol operations, plan costs, rule checks and protected-device state without exporting raw conversation or RPC payloads.

**Rules → presence → electricity price.** A proposal with conflicts is blocked. If time, household rules or the tariff change, OffPeak requires a fresh proposal rather than silently applying outdated assumptions.

## How we built it

The browser is a real MCP client using `@modelcontextprotocol/sdk` 1.32.1. It initializes protocol **2025-11-25**, discovers tools and resources, and calls **17 tools** over **Streamable HTTP**. The TypeScript/Express server uses a fresh MCP server and transport per request; household state lives in a separate store.

Pricing, scheduling, presence and savings use deterministic TypeScript. A conversation model chooses tools and phrases responses; it does not invent electricity prices or compute savings. The public demo uses the zero-cost mock router, with a scripted fallback. The optional Bedrock Converse proxy follows the same browser-owned tool loop.

The light console preserves text input, push-to-talk, browser speech, voice-only mode, occupancy controls, simulated time, ledger and protocol Inspector. The simulated device is a dark 16:10 Echo Show screen authored at its own 960×600 size, with every text size at least 24 px and Alexa's reply as on-screen captions; it scales from a phone to the Large screen view. The MCP App timeline and native fallback consume the same structured tool results.

Every reply is written to be heard: decision first, at most two sentences, units in words ("24 cents a kilowatt-hour", "9.6 kilowatts"), amounts under a dollar in cents, and no IDs. That includes errors: a schema mismatch is spoken as a request for what's missing rather than the SDK's raw validation text. Device names are never silently swapped ("the TV" is not "the EV"); ambiguous ones get a question.

The deployed prototype runs on Cloudflare Workers with an isolated SQLite Durable Object per browser. It uses simulated devices and bundled tariffs. It is not connected to an Echo, the Alexa developer console, or the entrant's real home.

## AWS integration and validation boundaries

The repository implements SDK integrations for Bedrock Converse/tool use and rule parsing, DynamoDB persistence, EventBridge one-time schedules, optional Polly speech, and a Lambda/Web Adapter deployment path described by AWS CDK. These paths are compiled or tested with injected clients. The live public URL uses **Cloudflare and mock conversation**, not AWS runtime services.

Do not describe those adapters as a completed live AWS deployment. No Bedrock model ID, real Echo session, live smart-home action or Kiro usage is asserted. For AWS Builder, include the actual validation evidence the team completes; see [the readiness checklist](docs/hackathon-readiness.md) and [AWS validation runbook](docs/aws-validation.md). This pass stays free and prepares instructions without live AWS calls.

## Challenges and feedback

We documented concrete SDK issues: version compatibility, tool error schemas, the MCP App initialization race, pre-connection host context, bundle overhead and the optional GET stream returning 405 on a stateless server. This pass adds reproducible Windows launcher/export fixes and Workers deployment observations. Each friction entry records the task, steps, expected/actual result, severity, workaround and suggestion.

The feedback file separately addresses the MCP SDK, MCP Inspector, MCP Apps, OpenEI, AWS adapters, React/Vite, Cloudflare, test tools and REA, with an explicit boundary between live experience and offline validation.

## What we accomplished

- A complete no-key demo (`npm ci && npm run dev`, no `.env` needed) with 20 simulated devices, six rooms, shared whole-home devices and an actual MCP conversation loop.
- The golden scenario: **$7.74 modeled task savings**, EV at **80% by 4:45 AM**, deadlines and quiet hours respected, and planned load within **9.6 kW**.
- Server-side approval checks, explainable recorded actions, protected devices and supported undo operations.
- Conflicts that explain themselves: "I can't fit the washer before quiet hours start at 10 PM. Should I allow it during quiet hours or finish by 9:30 AM tomorrow instead?", each option priced.
- A public MIT tariff library with timezone/DST-aware prices, real tariff fixtures, a synthetic demo and 22 independent tests.
- 166 unit and integration tests and eight browser scenarios, including the guided walkthrough, downloadable evidence, fallback views, visitor isolation, approval, stale-plan recovery and a regression suite for everything a listener would hear.

## Impact and next steps

OffPeak makes the tradeoff visible: what a particular set of tasks costs now, what a valid proposed schedule costs, and which household constraints determine the difference. It is useful without asking a household to understand tariff schedules or manually coordinate four appliances.

Real deployment needs account/device authorization, current applicable tariffs, live integration validation and operational controls. Future work includes consent-based occupancy inputs, proactive completion announcements, richer tariff structures, solar/export accounting and validated comfort modeling. No guaranteed or population-wide savings are claimed.

## Built during the submission window

This repository was created on October 17, 2026, within the official August 31–October 23 submission period. On October 19 we shipped the AWS-style console and live public demo, then added the guided review, task-cost/guardrail evidence, large screen, downloadable receipts, stronger approval checks, Windows setup fixes and standalone Open Source contribution. On October 21 we audited the build against our spec and the official requirements and fixed what a judge would see or hear: the Echo Show screen, spoken errors and units, device matching, conflict options, arrival timing, targeted undo, rule phrasing, today's savings and a quick-start crash on fresh clones. The Git history and separate library commits provide reviewable evidence.

## Open Source mini challenge fields

- **Contribution URL:** <https://github.com/Darthh/tou-rates/commit/d2fb907>
- **Project repository:** <https://github.com/Darthh/tou-rates>
- **GitHub username:** `Darthh` (confirm additional teammates separately).
- **What:** A new MIT TypeScript project for residential OpenEI time-of-use tariffs.
- **How:** Normalize prices/schedules and fixed-charge units, then expose timezone/DST-aware price lookup and price slots. One runtime dependency, no dependency on the parent app, 22 tests, and reproducible standalone builds.
- **Why it matters:** Other energy applications can reuse the tariff handling independently of OffPeak's simulator.

This is prepared entry text. A public video link, team declarations and final Devpost submission are still required. The official deadline is **Friday, October 23, 2026 at noon PDT**.
