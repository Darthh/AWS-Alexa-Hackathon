# Off-Peak: Devpost submission (draft)

> **TODO(team) before submitting:**
> - Fill in the video link, the GitHub usernames, the public `tou-rates` repo URL, and the Bedrock model actually used.
> - Say honestly whether the video was recorded in Bedrock or scripted mode.
> - If the repo is private, add the reviewers as collaborators.

**Tagline:** Cut my power bill without wrecking my evening.

**Track:** Alexa+ (self-hosted MCP server, protocol 2025-11-25, Streamable HTTP). **Mini challenges:** AWS Builder, Open Source.

## The problem
Time-of-use electricity rates now cover millions of US households. Peak power (4–9 PM) can cost twice what it costs overnight. People are told to "shift usage", but nobody wants to babysit a dryer at 9 PM, set a car charger by hand, or wake up to a car that didn't charge. Smart-home routines can switch things on and off. They don't know what electricity costs in *your* rate plan, they can't coordinate several appliances against deadlines and quiet hours, and they can't tell you what you saved.

## What it does
Off-Peak is an Alexa+ add-on that works three ways.

**1. Plans appliances against your real rate.** Off-Peak loads the household's real utility rate plan from the OpenEI Utility Rate Database. Say *"Car charged by 7, dishes and laundry tonight, nothing loud after 10"* and it proposes a plan:
- the washer now
- the dryer at 9 PM, when peak ends and before quiet hours
- the dishwasher and the car overnight, at the cheapest rate

On our demo rate that's **about $7.74 cheaper** than running it all now. It runs the plan when you say "do it."

**2. Turns off what nobody is using.**
- **Away:** "We're heading out until 9" switches off standby loads and sets cooling back, while the fridge, router, and aquarium are protected and a running washer is never interrupted. Pre-cooling waits until peak ends.
- **One room:** "It's just me in the office" powers down the other rooms.
- **Idle:** standby devices in empty rooms go off after 30 minutes.

**3. Earns trust.**
- Every action has a reason and a dollar figure.
- "Why did the TV turn off?" gets a plain answer, and "Turn it back on" restores exactly what changed.
- "How much did Off-Peak save me today?" reports dollars by source.

**Rules > Presence > Price:** Off-Peak never trades a broken promise for a few cents.

## How we built it
- **MCP server (TypeScript, `@modelcontextprotocol/sdk` 1.32.1):**
  - Stateless Streamable HTTP on protocol 2025-11-25, with a new server per request.
  - 17 tools with routing-oriented descriptions, accurate annotations, Zod-validated inputs, output schemas, and speakable results (at most two sentences, one money figure, 12-hour times).
  - 4 resources, including an **MCP App** (`ui://off-peak/plan.html`) that renders the plan timeline on an Echo Show.
- **Deterministic core:**
  - A planner places washer→dryer pairs jointly, charges the EV in the cheapest 15-minute slots within the household load headroom, honors deadlines and quiet hours, and returns priced options when something can't fit.
  - Presence and savings engines.
  - All unit-tested, including the DST spring-forward night and a golden end-to-end scenario.
  - LLMs only at the edges.
- **`tou-rates` (open source, MIT):**
  - An OpenEI client and normalizer: tier-1 prices, per-month period naming, `$/day` fixed charges, newest-first plan lookup.
  - Price math (`priceAt`, `slots`, `describeDay`) on local wall-clock hours.
- **Alexa+ simulator:**
  - A real MCP client in the browser, with an MCP Inspector panel that shows `initialize`, `tools/list`, and `tools/call` live.
  - An LLM loop via Amazon Bedrock Converse with tool use, plus a zero-cost mock and a scripted mode.
  - Speech in and out, Echo Show and voice-only (Echo Dot) views.
  - A live simulated house over SSE, and a sim clock with time travel.

## How we used AWS
- **Amazon Bedrock (Converse + tool use):** the simulated Alexa's reasoning loop, and a fallback parser that turns natural-language household rules into JSON validated with Zod.
- **AWS Lambda + Function URL:** the MCP server, unmodified Express behind the Lambda Web Adapter, plus an executor Lambda.
- **Amazon DynamoDB:** a single-table design for the household, devices, rules, plans, scheduled steps, and ledger.
- **Amazon EventBridge Scheduler:** one-time `at()` schedules in the household's timezone that start each appliance step and delete themselves.
- **Amazon Polly:** optional neural voice.
- **AWS CDK (TypeScript):** the whole stack, deployable and destroyable.

> **TODO(team):** state what was deployed and tested live, and the Bedrock model used.

## Challenges
- MCP SDK v1 vs. v2 (protocol 2025-11-25 vs. 2026-07-28) and the matching ext-apps versions.
- SDK clients reject `isError` results whose `structuredContent` doesn't match the output schema, so we moved error details to `_meta`.
- An MCP Apps host race where the View's `ui/initialize` arrived before the bridge was listening.
- Real tariffs are messy: stale rates first, superseded versions, period indices reused across seasons, `$/day` fixed charges.
- Keeping every tool response short enough to speak without losing the number that matters.

All of it is documented in FRICTION_LOG.md.

## Accomplishments
- The golden scenario holds end to end: a weekday at 5:30 PM gives the plan above, $7.74 saved, the car at 80% by 4:45 AM, and the load never over 9.6 kW.
- Every action is explainable and undoable.
- The demo runs with zero keys and no network.

## What we learned
Trustworthy automation is mostly about **constraints and receipts**, not cleverness: deadlines, quiet hours, never-off devices, an exact undo, and a reason for every action. MCP tool design for voice is its own craft: decision first, one number, no IDs, and a clarifying question when "the lamp" is ambiguous.

## What's next
- Read Alexa's own occupancy and Hunches signals, with consent.
- Proactive announcements ("the car is charged").
- Control the customer's Alexa-connected devices directly instead of the simulated home or Home Assistant.
- Tiered and baseline pricing, solar and export credits, and a thermal model for setback savings.

## Potential impact
Most of a TOU household's savings come from a handful of flexible loads: the EV, laundry, the dishwasher, and the water heater. Standby waste in empty rooms adds tens of dollars a year. Off-Peak captures both without asking people to change habits. Shifting load out of 4–9 PM also flattens the evening peak that utilities pay the most to serve.

## Open source mini challenge
- **Repository:** `tou-rates` (MIT). **TODO(team):** add the public repo URL.
- **What:** Normalizes US residential time-of-use tariffs from the OpenEI URDB into schedulable prices.
- **How:** An OpenEI client, a normalizer (per-month period naming, cross-season period splitting, fixed-charge units), and DST-correct price math. One runtime dependency, 21 tests against real fixtures.
- **Why it matters:** Every energy app that wants to answer "when is power cheap for *this* household" has to solve the same messy URDB edge cases first.
- **Team GitHub usernames:** **TODO(team)**
