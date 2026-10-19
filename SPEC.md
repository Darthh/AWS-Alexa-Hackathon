# Off-Peak — Build Prompt for the Coding Agent

> **How to use:** Save this file as `SPEC.md` at the root of an empty repo, open the repo in your coding assistant (Kiro, Claude Code, Cursor), and say:
> **"Read SPEC.md end to end, then start Milestone 0."**

---

## 0. Your role and how to work

You are the lead engineer on a 3-person student team building **Off-Peak**, an Alexa+ add-on, for the Amazon Developer Hackathon **"Build, Ship, Shape"**.
- **Primary track:** Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP, demoed through our own web client that is a real MCP client).
- **Mini challenges:** AWS Builder (Bedrock, Lambda, DynamoDB, EventBridge Scheduler) and Open Source (we publish the tariff parser as its own MIT repo).
- **Deadline:** Thursday, Oct 23 2026, 12:00 PM PDT. Today is Monday Oct 19. Hard internal stop for code: **Thursday 10:30 AM PDT**.
- **Judging criteria:** Tech Implementation, Design (coherent, intuitive for the target device), Potential Impact (credible customer need), Quality of the Idea (shows we understand the Alexa+ ecosystem). Judges include Alexa evangelists and solutions architects, so MCP design quality matters.

**Working rules**
1. Build milestone by milestone (Section 14). Don't start the next milestone until the current Definition of Done passes. After each milestone, print a 5-line summary: what works, how to run it, what's stubbed, risks, what's next.
2. Scope is fixed in Section 3. Anything else goes in `BACKLOG.md`. Prefer the simplest thing that demos well.
3. **Deterministic core.** Pricing, planning, presence, and savings math are plain, unit-tested TypeScript. LLMs are used only at the edges (understanding the user, parsing natural-language rules, phrasing).
4. **Everything has an offline fallback** (demo tariff, simulated home, simulated clock, mock LLM, scripted mode) so the demo can never be blocked by an API key, the network, or an AWS bill.
5. Log one-line decisions in `DECISIONS.md`. Whenever an SDK, doc, or tool surprises you, add an entry to `FRICTION_LOG.md` (template in Section 16). Friction logs earn up to a 10% judging bonus, so log as you go.
6. **Never invent Alexa APIs.** Hackathon participants cannot connect to a real Alexa+ device or developer console. Our web client *simulates* Alexa+ and is a *real* MCP client.
7. Ask me before: adding a top-level dependency not listed here, changing the MCP protocol version or SDK major version, or deleting files.

---

## 1. Product in one paragraph

**Off-Peak — "Cut my power bill without wrecking my evening."**
Off-Peak knows what electricity costs right now (from the household's real utility rate plan), moves flexible appliances into the cheapest hours, turns off power nobody is using (when the house is empty or only one part of it is in use), and turns things back on when people return. It never breaks the household's rules (car charged by 7 AM, nothing loud after 10 PM, never touch the fridge). It explains every action in plain language and dollars, and every action can be undone.

**Priorities:**
1. Price-aware scheduling — the headline feature and the name.
2. Presence-aware on/off — away mode, zone mode ("just me in the office"), arrival.
3. Household rules — the guardrails that make automation trustworthy.

**Decision order when they conflict: Rules > Presence > Price.** Never trade a broken promise for a few cents.

---

## 2. Why it's different (this goes in the README)

Alexa today offers Hunches (guesses when you're away/asleep and can turn off lights or adjust thermostats and water heaters), routines triggered when you leave/arrive or say "I'm heading out," Echo ultrasound occupancy routines (configured by hand, room by room), Smart Thermostat nudging the setpoint toward cleaner grid times, and an Energy Dashboard that reports usage after the fact.

None of those plan around **the household's actual rate-plan prices**, **coordinate several appliances against deadlines, quiet hours, and a household load limit**, or **report savings in dollars with a reason for every action**. Off-Peak does all three, in one conversational plan, with undo.

---

## 3. Scope

### Must have (the demo depends on these)
- **Tariffs:** load a residential time-of-use (TOU) rate from the OpenEI Utility Rate Database by ZIP and normalize it; bundled fixture + synthetic `DEMO_TOU` fallback.
- **Price tools:** `get_price_now`, `find_cheapest_window`.
- **Planner:** EV charging (interruptible), dishwasher, washer, dryer (non-interruptible; dryer after washer), honoring deadlines, quiet hours, never-off, and max household load. Computes baseline ("run it all now") vs. plan cost. Infeasible requests return a clear conflict with 2–3 options.
- **Execution:** `apply_plan` schedules steps; a scheduler driven by the clock executes them and writes ledger entries.
- **Presence:** modes `home | away | sleep | zone`, plus `arriving`. Idle-off of standby devices in unoccupied zones. Never-off devices are protected server-side.
- **Trust:** ledger, `explain`, `undo`, `get_savings`.
- **World:** simulated home (≈15 devices, 6 zones) and a `SimClock` with time travel.
- **MCP server:** Streamable HTTP, protocol **2025-11-25**.
- **Web client ("Alexa+ simulator"):** real MCP client in the browser, Bedrock LLM proxy (with mock mode), speech in/out, Echo Show view + voice-only toggle, house panel, clock controls, ledger, **MCP traffic inspector**, and a scripted fallback mode.

### Should have
- MCP Apps UI resource for the plan timeline (`ui://off-peak/plan.html`).
- `add_rule` natural-language parsing via Bedrock (deterministic parser first, Bedrock second).
- DynamoDB store + EventBridge Scheduler adapters behind env flags; optional Lambda deploy via CDK.
- `tou-rates` package published as a separate public MIT repo (Open Source mini challenge).
- Optional Home Assistant device adapter.

### Won't (put in BACKLOG.md)
Tiered/baseline allowances beyond tier 1, demand charges, net metering/solar export, real thermal modeling, learning from behavior, specific thermostat brands, multi-household auth, mobile app, phone geofencing.

---

## 4. Hard technical constraints

- **MCP protocol 2025-11-25 over Streamable HTTP.**
  - Use **`@modelcontextprotocol/sdk` v1.x** (imports like `@modelcontextprotocol/sdk/server/mcp.js`, `.../server/streamableHttp.js`, `.../client/index.js`, `.../client/streamableHttp.js`).
  - **Do NOT use the newer split v2 packages** (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`, etc.). They target protocol 2026-07-28, which removes the `initialize` handshake. Alexa+ supports 2025-11-25, and the hackathon FAQ defines a valid demo client as one that sends `initialize`, `tools/list`, and `tools/call` over Streamable HTTP.
  - Add an integration test asserting the negotiated `protocolVersion === "2025-11-25"`.
- **Server mode:** stateless — `sessionIdGenerator: undefined`, `enableJsonResponse: true` — and **create a new `McpServer` + transport per request** (reusing one server instance across concurrent HTTP requests breaks). Close both on `res.on("close")`. State lives in the Store, not the MCP session. This is also Lambda-friendly.
- **CORS** on `/mcp` for `WEB_ORIGIN`. Allow headers: `content-type, accept, mcp-protocol-version, mcp-session-id, authorization`. Expose: `mcp-session-id`.
- The repo must **actually call the MCP SDK in code** (imports and entry point), not just mention MCP in the README.
- **Stack:** Node 22, TypeScript (strict, ESM), npm workspaces, Vitest, Zod, Luxon (household timezone default `America/Los_Angeles`), Express for the server, Vite + React for the web client.
- **Units:** money as integer **cents** (round at the end of each step); price as cents/kWh (may be fractional); energy in kWh; power in kW (W for standby).
- **One command, zero keys:** `npm run dev` starts server (`:8787`) and web (`:5173`) using demo tariff, sim home, sim clock, and mock LLM. Hosting is optional — a locally runnable repo plus the demo video is enough for judging.
- **License:** MIT. No secrets in the repo; provide `.env.example`.

---

## 5. Repo layout

```
off-peak/
  SPEC.md                    # this file
  README.md  LICENSE  DECISIONS.md  BACKLOG.md
  FRICTION_LOG.md  FEEDBACK.md  FEATURE_REQUESTS.md  DEMO_SCRIPT.md  SUBMISSION.md
  package.json               # npm workspaces + root scripts (dev, test, build, lint)
  .env.example
  fixtures/
    demo-home.json           # seed household (Section 15)
    tariffs/demo-tou.json    # synthetic DEMO_TOU
    tariffs/*.json           # 2–3 trimmed real OpenEI responses (once you have a key)
  packages/
    tou-rates/               # standalone: OpenEI client + normalizer + price slots (publishable)
    core/                    # pure domain: types, rules, planner, presence, savings, speech helpers
    server/                  # MCP server + adapters + sim admin + LLM proxy
    ui-apps/                 # MCP App HTML (plan timeline), single-file build
    web/                     # Alexa+ simulator (Vite + React), browser MCP client
  infra/                     # AWS CDK (optional deploy)
```

`core` and `tou-rates` have **no I/O dependencies** besides `fetch` in the OpenEI client, which is injectable.

---

## 6. Domain model (`packages/core/src/types.ts`)

```ts
export type Cents = number;        // integer
export type ZoneId = string;
export type DeviceId = string;
export type HHmm = `${number}${number}:${number}${number}`;

export type Mode = "home" | "away" | "sleep" | "zone";

export interface Household {
  id: string; name: string; timezone: string; zip?: string;
  rateId: string | null;
  mode: Mode;
  activeZones: ZoneId[];                 // used when mode === "zone"
  returnAt?: string;                     // ISO, when away
  autonomy: { idleOff: "auto" | "ask"; zoneOff: "auto" | "ask" };
  awaySetpointF: number;                 // e.g. 82 (cooling season)
  zones: Zone[]; devices: Device[]; rules: Rule[];
}

export interface Zone { id: ZoneId; name: string; aliases: string[]; lastMotionAt?: string }

export type DeviceKind =
  | "ev_charger" | "dishwasher" | "washer" | "dryer" | "water_heater" | "thermostat"
  | "light" | "plug" | "tv" | "console" | "speaker" | "pc" | "printer"
  | "fridge" | "router" | "aquarium" | "fan";

export interface Device {
  id: DeviceId; name: string; aliases: string[]; zoneId: ZoneId; kind: DeviceKind;
  ratedKw: number;                        // draw when on/running
  standbyW?: number;                      // draw when idle/standby
  cycle?: { durationMin: number; energyKwh: number; interruptible: boolean };
  battery?: { capacityKwh: number; maxKw: number; socPercent: number };   // EV
  noisy?: boolean;
  flexible: boolean;                      // can be time-shifted
  neverOff?: boolean;
  tags?: ("medical" | "security" | "network" | "food")[];
  state: DeviceState;
}

export interface DeviceState {
  on: boolean; running?: boolean; powerW: number;
  setpointF?: number; ecoMode?: boolean; lastActiveAt?: string;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type Rule =
  | { id: string; type: "deadline"; deviceId: DeviceId; by: HHmm; targetPercent?: number; days?: Weekday[] }
  | { id: string; type: "quiet_hours"; start: HHmm; end: HHmm; appliesTo: "noisy" }
  | { id: string; type: "comfort"; zoneId?: ZoneId; minF: number; maxF: number; when: "occupied" | "always" }
  | { id: string; type: "never_off"; deviceId: DeviceId }
  | { id: string; type: "ask_first"; deviceId: DeviceId }
  | { id: string; type: "max_load"; kw: number };

export interface NormalizedTariff {
  rateId: string; utility: string; name: string;
  source: "openei" | "fixture" | "demo"; timezone: string;
  periods: { index: number; name: string; centsPerKwh: number }[];  // tier-1 rate + adj
  weekday: number[][];  // 12 months × 24 hours → period index (0-based)
  weekend: number[][];
  fixedMonthlyCents?: Cents; isTou: boolean; warnings: string[];
}

export interface PriceSlot { start: string; end: string; centsPerKwh: number; periodName: string }

export interface TaskRequest {
  deviceId: DeviceId; earliestStart?: string; finishBy?: string;
  targetPercent?: number; after?: DeviceId;
}

export interface PlanStep {
  id: string; deviceId: DeviceId; action: "run" | "charge" | "set" | "on" | "off";
  start: string; end: string; kwh: number; costCents: Cents; reason: string;
}

export interface Conflict {
  deviceId: DeviceId; message: string;
  options: { label: string; extraCostCents?: Cents; change: Partial<TaskRequest> | { relaxRuleId: string } }[];
}

export interface Plan {
  id: string; createdAt: string; steps: PlanStep[];
  costCents: Cents; baselineCostCents: Cents; savingsCents: Cents;
  ruleChecks: { ruleId: string; ok: boolean; note: string }[];
  conflicts: Conflict[]; status: "proposed" | "applied" | "cancelled";
}

export interface LedgerEntry {
  id: string; at: string; deviceId?: DeviceId; action: string; reason: string;
  source: "plan" | "away" | "zone" | "sleep" | "idle" | "arrival" | "user" | "undo";
  estSavedCents: Cents; estimate: boolean;
  before?: Partial<DeviceState>; after?: Partial<DeviceState>;
  undoOf?: string; undone?: boolean;
}
```

---

## 7. Tariffs (`packages/tou-rates`) — standalone, publishable

**OpenEI request:**
`GET https://api.openei.org/utility_rates?version=latest&format=json&api_key=$OPENEI_API_KEY&sector=Residential&detail=full&approved=true&address=<ZIP>&limit=50`
Fetch a single rate with `&getpage=<label>`. Keys are free.

**Fields used:** `label`, `utility`, `name`, `startdate`, `enddate`, `energyratestructure` (array per period → array of tiers `{max, unit, rate, adj, sell}`), `energyweekdayschedule` / `energyweekendschedule` (12 months × 24 hours of 0-based period indices), `fixedmonthlycharge`.

**Normalize:**
- `centsPerKwh(period) = (tier[0].rate + (tier[0].adj ?? 0)) × 100`. If a period has more than one tier, add the warning "Tiered pricing simplified to tier 1."
- Drop expired rates (`enddate` in the past). Mark `isTou = true` if any month's weekday schedule has more than one distinct period. Rank TOU rates first, then names containing "TOU" / "Time of Use".
- Name periods by relative price per month: cheapest → "super off-peak" (if 3+ periods) or "off-peak", most expensive → "peak", the rest → "off-peak"/"mid-peak".
- Schedules are **local wall-clock hours**. Compute with Luxon in the household timezone. Test DST spring-forward (23-hour day) and fall-back (25-hour day).

**API:**
- `fetchRatePlans(zip, apiKey, fetchImpl?)`, `normalize(raw)`
- `priceAt(tariff, instant)`, `slots(tariff, from, to, stepMin = 15)`
- `describeDay(tariff, date)` → e.g. "Peak 4–9 PM today; cheapest midnight–6 AM."

**Fallbacks:** `fixtures/tariffs/*.json` and **`DEMO_TOU`** (synthetic, always labeled "Demo rate (synthetic)" in UI and speech):

| Period | Weekdays | Weekends | ¢/kWh |
|---|---|---|---|
| super off-peak | 00:00–06:00 | 00:00–06:00 | 24 |
| off-peak | 06:00–16:00, 21:00–24:00 | 06:00–24:00 | 31 |
| peak | 16:00–21:00 | — | 49 |

Give this package its own README, MIT LICENSE, and zero dependencies on `core`/`server`, so it can be pushed as a separate public repo for the Open Source mini challenge.

---

## 8. Planner (`packages/core/src/planner.ts`) — pure function

`plan(household, tariff, now, tasks, rules) → Plan`

1. **Horizon:** `now` → max(latest deadline, now + 24h). 15-minute slots with price.
2. **Resolve tasks:** duration/energy from `device.cycle`. EV energy = `(targetPercent − socPercent) / 100 × capacityKwh`, power = `maxKw`. Deadline rules apply automatically when the device has one (e.g. EV 80% by 07:00).
3. **Hard constraints (per slot, per task):** within `[earliestStart ?? now, finishBy]`; noisy tasks may not *overlap* quiet hours; dependency `after` (dryer.start ≥ washer.end); concurrent load (planned kW + estimated base load 0.5 kW) ≤ `max_load`.
4. **Order:** topological by dependency, then earliest deadline first.
5. **Non-interruptible:** evaluate every feasible start slot; cost = Σ slot price × kW × hours; pick the minimum; break ties by earliest start.
6. **Interruptible (EV):** sort feasible slots by price ascending, then by time; take slots until energy is met, respecting `maxKw` and remaining load headroom; merge contiguous slots into steps.
7. **Baseline** = every task starts as soon as possible from `now` in dependency order, ignoring price, quiet hours, and load limit ("what you'd do without Off-Peak"). `savingsCents = max(0, baseline − plan)`. If rules force a higher cost, say so in a check.
8. **Infeasible:** return a `Conflict` with 2–3 options (e.g. "Run it now at peak (+$0.40)", "Finish by 7 AM tomorrow instead", "Allow it during quiet hours", "Charge to 60% instead of 80%"), each with its cost delta.
9. **Every step gets a human `reason`**, e.g. "Peak ends at 9 PM; finishes at 10 PM, before quiet hours."
10. Deterministic, under 50 ms for 5 tasks.

**Required tests:** deadline met; quiet hours respected; dryer after washer; load cap prevents EV + dryer overlap; EV picks the cheapest slots; infeasible case returns a conflict with options; DST day; weekend (no peak) produces different choices; golden scenario (Section 15).

---

## 9. Presence engine (`packages/core/src/presence.ts`)

- **away** (optional `returnAt`): for every device that is **not** `neverOff` → lights off; TV/console/speaker/pc/printer and standby plugs off; thermostat → `awaySetpointF` (respecting `comfort` rules with `when: "always"`); water heater `ecoMode = true`. **Running plan steps continue** (never interrupt a dishwasher mid-cycle). Return `keptOn[]` with reasons ("Fridge — never off").
- **zone(activeZones):** same as away, but only for inactive zones. Thermostat setback only if its zone is inactive.
- **sleep:** lights off outside the bedroom; TV/console off; noisy appliances blocked (quiet hours).
- **home:** restore **only devices Off-Peak turned off**, using ledger `before` states, not everything in the house.
- **Idle detection:** a device with `standbyW` that is on, drawing ≤ `standbyW + 2` W, in a zone with no motion for ≥ 30 simulated minutes → idle-off (auto or ask, per `autonomy.idleOff`). A zone is occupied if it had motion in the last 20 minutes or the mode/activeZones says so.
- **arriving(eta):** schedule restore and pre-conditioning. Start cooling 30 minutes before `eta`, but **never inside a peak period** — if that window is peak, start when peak ends (or at `eta` if that comes first) and explain why.
- **Savings:** idle-off saved = `standbyW / 1000 × hours off × price per slot` until the device turns back on. Thermostat setback savings are `estimate: true` (document the assumption in DECISIONS.md) and excluded from headline numbers unless `includeEstimates` is set.
- **Safety:** automation never touches `neverOff` devices. A direct user request to turn one off returns `needsConfirmation`. `ask_first` devices always return `needsConfirmation` for automation.

---

## 10. MCP server (`packages/server`)

**HTTP routes (Express):**
- `POST /mcp` — MCP endpoint. `GET /mcp` and `DELETE /mcp` return 405 (stateless mode).
- `GET /health`
- **Sim admin (NOT MCP tools; they represent the real world; enabled only when `SIM_ADMIN=1`):** `GET /sim/state`, `POST /sim/clock` `{action: "play" | "pause" | "set" | "speed", value?}`, `POST /sim/motion` `{zoneId}`, `POST /sim/reset`, plus an SSE stream `GET /sim/events` for the web client's live house panel.
- `POST /llm/converse` and optional `POST /llm/tts` — Bedrock/Polly proxy for the web client (Section 12). Not part of MCP.

**Ports/adapters** (`server/src/ports.ts`), chosen by env:
`Clock` (SimClock | RealClock) · `Store` (Memory | JsonFile | DynamoDB) · `Scheduler` (LocalScheduler driven by Clock | EventBridgeScheduler) · `Devices` (SimHome | HomeAssistant) · `Tariffs` (Demo | Fixture | OpenEI) · `RuleParser` (Deterministic | Bedrock).

**Server identity:** name `off-peak`, version `0.1.0`, and an `instructions` string in the initialize result: three sentences describing what Off-Peak does and when to use which tools (helps routing; mirrors how Alexa+ picks add-ons).

**Every tool returns:**
- `content: [{ type: "text", text }]` — **speakable**: at most 2 short sentences, decision first, at most one money figure ("about $7.70 cheaper"), 12-hour local times ("9 PM"), never IDs, the word "estimated" for estimates, and "demo rate" when using `DEMO_TOU`.
- `structuredContent` validated against the tool's `outputSchema`.
- Domain errors: `isError: true` with a speakable message and `structuredContent.error`.
- Tool **annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) set accurately.
- Device references accept names/aliases/zones ("the car", "living room TV") and are resolved server-side with fuzzy matching. If ambiguous, return a speakable clarifying question with candidates.

**Tools**

| # | Tool | Input | Output (structuredContent) | Annotations |
|---|---|---|---|---|
| 1 | `find_rate_plans` | `{ zip }` | `{ plans: [{ rateId, utility, name, isTou, summary }] }` | readOnly, openWorld |
| 2 | `select_rate_plan` | `{ rateId }` | `{ tariff summary, today: describeDay }` | idempotent |
| 3 | `get_home_status` | `{}` | `{ mode, activeZones, running[], scheduled[], priceNow, nextChange, idleCandidates[] }` | readOnly, UI-bound |
| 4 | `get_price_now` | `{}` | `{ centsPerKwh, periodName, until, next: { centsPerKwh, periodName } }` | readOnly |
| 5 | `find_cheapest_window` | `{ device? , durationMinutes?, finishBy? }` | `{ start, end, costCents, costIfNowCents }` | readOnly |
| 6 | `plan_tasks` | `{ tasks: [{ device, finishBy?, earliestStart?, targetPercent?, after? }] }` | `Plan` | readOnly (proposes only), UI-bound |
| 7 | `apply_plan` | `{ planId }` | `{ scheduledSteps[] }` | idempotent |
| 8 | `cancel_plan` | `{ planId? , stepId? }` | `{ cancelled[] }` | idempotent |
| 9 | `set_mode` | `{ mode, activeZones?, returnAt?, confirm? }` | `{ actions[], keptOn[], needsConfirmation?, undoToken }` | — |
| 10 | `arriving` | `{ eta }` (`"HH:mm"` or minutes) | `{ restoreAt, preconditionAt, notes }` | — |
| 11 | `control_device` | `{ device, action: "on"/"off"/"set", value?, confirm? }` | `{ device, before, after, needsConfirmation? }` | — |
| 12 | `add_rule` | `{ text }` | `{ rule, confirmationText }` | — |
| 13 | `list_rules` / `remove_rule` | `{}` / `{ ruleId }` | `{ rules[] }` | readOnly / idempotent |
| 14 | `explain` | `{ device? , actionId? , stepId? }` | `{ because, entry }` | readOnly |
| 15 | `undo` | `{ actionId? }` (default: last) | `{ restored[] }` | — |
| 16 | `get_savings` | `{ period: "today" / "week" / "month", includeEstimates? }` | `{ totalCents, bySource: { shift, idle, away }, topWins[] }` | readOnly, UI-bound |

Write tool **descriptions for routing**: 1–2 sentences plus example phrasings, e.g. `plan_tasks`: *"Plan when to run flexible appliances (EV charging, dishwasher, washer, dryer) at the lowest cost while honoring deadlines and quiet hours. Use for: 'run the dishwasher when it's cheapest', 'charge the car by 7', 'do the laundry tonight but nothing loud after 10'."*

**Resources:** `offpeak://tariff/current`, `offpeak://household`, `offpeak://ledger/today` (`application/json`), and `ui://off-peak/plan.html` (MCP App, Section 11).

**Server skeleton hint (SDK v1):**
```ts
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

app.post("/mcp", async (req, res) => {
  const server = buildServer(deps);          // new instance per request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
// buildServer: new McpServer({ name: "off-peak", version: "0.1.0" }, { instructions })
//   .registerTool(name, { title, description, inputSchema, outputSchema, annotations, _meta }, handler)
```
Verify each API against the installed SDK version. Log any mismatch with this hint in FRICTION_LOG.md.

---

## 11. MCP App: plan timeline (`packages/ui-apps`) — should have

A single self-contained HTML file (Vite single-file build, no network) that renders purely from `structuredContent`:
- 24-hour price strip colored by period, "now" marker, quiet hours shaded.
- One row per device (max 5 rows) with plan steps as bars; deadline markers; savings badge.
- Designed for an Echo Show at arm's length: ≥ 24 px type, high contrast, no hover-only info.

Follow the official MCP Apps extension:
- The tool declares `_meta.ui.resourceUri = "ui://off-peak/plan.html"`.
- The resource is served with mimeType `text/html;profile=mcp-app`.
- The app talks to the host over `postMessage` JSON-RPC: `ui/initialize`, `ui/notifications/initialized`, `ui/notifications/tool-input`, `ui/notifications/tool-result`, and handles `ui/resource-teardown`.

Prefer the official `@modelcontextprotocol/ext-apps` package: the app-side `App` class, any server helpers for registering app tools/resources, and any host-side bridge we can reuse in our web client. If SDK v1 `registerTool` doesn't pass `_meta` through in the installed version, use the ext-apps server helper. If MCP Apps slips, the web client renders the same timeline natively from `structuredContent`; ship that first.

---

## 12. Web client (`packages/web`) — the Alexa+ simulator

**MCP**
- **The browser is the MCP client:** SDK v1 `Client` + `StreamableHTTPClientTransport` → `VITE_MCP_URL`. On load: `initialize` → `tools/list` → `resources/list`.
- **MCP Inspector panel:** log every JSON-RPC message (direction, method, id, latency, size) by wrapping the transport's `send`/`onmessage`. Show a badge: **"MCP 2025-11-25 · Streamable HTTP"** with the negotiated version. Judges must *see* `initialize`, `tools/list`, and `tools/call` happen.

**Conversation loop**
1. User utterance → `POST /llm/converse` with `{ messages, tools }` (MCP tools mapped to Bedrock `toolSpec` with `inputSchema.json`).
2. If the model returns `toolUse`, the **browser** calls MCP `tools/call`, appends a `toolResult`, and loops (max 5 tool calls per turn).
3. The final text is shown as captions and spoken.

**LLM proxy** (`server` route): Amazon Bedrock Runtime **Converse** API with `toolConfig`. Model from `BEDROCK_MODEL_ID` (choose a model available in your region that supports Converse tool use; record the choice in DECISIONS.md), region from `AWS_REGION`. `LLM_MODE=mock` returns scripted model responses (tests, zero cost).

**System prompt for the simulated Alexa (use verbatim):**
> You are Alexa+, speaking aloud in a home. Use the Off-Peak tools for anything about electricity cost, when to run appliances, leaving or arriving home, which rooms are in use, or saving money. Call plan_tasks before apply_plan, and ask the user to confirm unless they already said to go ahead. Reply in at most two short sentences, based on the tool's text. Never invent prices, times, or savings; only state numbers returned by tools. Use 12-hour times.

**Scripted mode** (`?mode=scripted`): a deterministic regex intent router that maps the demo utterances to tool calls with no LLM. This is the backup for recording the video.

**Speech:** Web Speech API `SpeechRecognition` (push-to-talk button + spacebar) and `speechSynthesis`; a text box is always available. Optional Amazon Polly via `/llm/tts`.

**Layout (desktop ~1440 px wide):**
- **Left — "Echo Show" frame (16:10, ~960×600):** captions + rendered UI (MCP App iframe if available, else the native React timeline). Toggle **"Voice-only (Echo Dot)"** hides the screen and shows only a listening indicator + captions.
- **Right top — House panel:** zones as cards; devices with on/off, live watts, badges (never-off, scheduled, idle); a "people here" toggle per zone that posts `/sim/motion`.
- **Right middle — Sim clock:** time, play/pause, speed 1× / 60× / 600×, jump buttons (5:30 PM, 9 PM, midnight, 7 AM); price strip with now marker.
- **Right bottom — tabs:** Ledger feed + savings counter | MCP Inspector.

**Style:** dark, Alexa-like theme with a cyan accent, large readable type, keyboard operable, captions always visible.

---

## 13. AWS integration (AWS Builder mini challenge)

Document all of this in the README under "AWS services used and how":
- **Amazon Bedrock** (Converse + tool use): the simulated Alexa's reasoning loop; `add_rule` parsing to JSON validated by Zod. Mock in dev; hit the live API only to validate.
- **AWS Lambda + Function URL** (optional deploy): MCP server (Express) behind the AWS Lambda Web Adapter layer; executor Lambda for scheduled steps.
- **Amazon DynamoDB:** single table `OffPeak` — `pk = HH#<householdId>`, `sk = RULE#… | PLAN#… | STEP#… | DEVICE#… | LEDGER#<iso>`.
- **Amazon EventBridge Scheduler:** one-time `at(yyyy-mm-ddThh:mm:ss)` schedules with `ScheduleExpressionTimezone` = household timezone, target = executor Lambda (with role ARN), `ActionAfterCompletion: DELETE`. Used only when `CLOCK=real`; demos use SimClock + LocalScheduler.
- **Amazon Polly** (optional): TTS.
- **AWS CDK (TypeScript)** in `infra/`, with `cdk deploy` / `cdk destroy` documented. Tear resources down after testing. The server does not need to stay live during judging.
- If the team builds with **Kiro Crew**, note it in the README — that qualifies for AWS Builder on its own.

---

## 14. Milestones and Definition of Done

**M0 — Skeleton (Mon, ~2h)**
Workspaces, tsconfig, lint, Vitest; server with `get_price_now` on `DEMO_TOU`; `npx @modelcontextprotocol/inspector` connects over Streamable HTTP.
*DoD:* `npm test` green, including the protocol-version integration test (initialize → `protocolVersion === "2025-11-25"` → tools/list contains `get_price_now`); `npm run dev` serves `:8787`.

**M1 — Tariffs + world (Mon night)**
`tou-rates` (OpenEI client, normalize, fixtures, `DEMO_TOU`, DST tests); SimClock; SimHome seeded from `fixtures/demo-home.json`; Memory + JsonFile store; sim admin routes.
*DoD:* `find_rate_plans`, `select_rate_plan`, `get_price_now`, `find_cheapest_window`, `get_home_status` work in the Inspector.

**M2 — Planner + execution (Tue)**
Rules model, planner + tests, `plan_tasks`, `apply_plan`, `cancel_plan`; LocalScheduler executes steps as the sim clock passes their start; ledger entries written.
*DoD:* golden scenario test (Section 15) passes.

**M3 — Presence + trust (Tue night / Wed AM)**
`set_mode`, `arriving`, `control_device`, idle detection, `explain`, `undo`, `get_savings`, `add_rule` (deterministic parser first), `list_rules`/`remove_rule`.
*DoD:* away mode turns off 6+ devices while fridge/router/aquarium stay untouched; `undo` restores exactly what changed; savings shows shift + idle.

**M4 — Web client (Wed)**
Browser MCP client + Inspector, LLM proxy (mock + Bedrock), scripted mode, speech, Echo Show + voice-only, house panel (SSE), clock controls, ledger.
*DoD:* the full demo script (Section 17) runs end to end in **scripted** mode **and** in **Bedrock** mode.

**M5 — Polish + AWS (Wed night)**
MCP App timeline; Bedrock rule parser; DynamoDB + EventBridge adapters behind env flags; optional CDK deploy; README with a Mermaid architecture diagram; push `tou-rates` as its own public MIT repo.
*DoD:* README lets a stranger run the demo in under 5 minutes with zero keys.

**M6 — Ship (Thu AM; code freeze 10:30 AM PDT)**
Record the video, finish FEEDBACK.md / FRICTION_LOG.md / FEATURE_REQUESTS.md / SUBMISSION.md, add reviewers as GitHub collaborators if the repo is private, submit before noon.

---

## 15. Seed data and the golden scenario

**`fixtures/demo-home.json`** — "Demo Home", timezone `America/Los_Angeles`, ZIP from `DEMO_ZIP` (optional), tariff `DEMO_TOU`, mode `home`, `awaySetpointF: 82`.

| Zone | Devices |
|---|---|
| garage | EV charger — battery 75 kWh, SOC 35%, maxKw 7.2, flexible |
| laundry | washer — 60 min, 0.5 kWh, noisy, flexible · dryer — 60 min, 3.0 kWh, noisy, flexible |
| kitchen | dishwasher — 120 min, 1.2 kWh, **not** noisy, flexible · fridge — neverOff (food) · kitchen lights · smart speaker plug (standby 3 W) |
| living_room | TV (on 120 W, standby 15 W) · game console (standby 12 W) · soundbar (standby 8 W) · floor lamp |
| office | PC + monitors plug (on 150 W, standby 20 W) · printer (standby 6 W) · desk lamp |
| bedroom | bedside lamp · fan |
| whole home | thermostat (cool, setpoint 74 °F) · water heater (eco off) · router — neverOff (network) · aquarium — neverOff |

**Seed rules:** quiet hours 22:00–07:00 (noisy); EV deadline 80% by 07:00 on weekdays; never-off: fridge, router, aquarium; comfort 68–78 °F when occupied; max load 9.6 kW. The load cap forces EV and dryer not to overlap — a good demo moment.

**Golden scenario test** (`scenario.golden.test.ts`) — sim time: a **weekday at 5:30 PM**, `DEMO_TOU`.
Request: car to 80% by 7 AM, dishes and laundry tonight, nothing loud after 10.
Assert:
- The dryer ends ≤ 22:00 and starts ≥ the washer's end.
- No noisy step overlaps 22:00–07:00.
- EV reaches ≥ 80% by 07:00, and all EV steps fall in 00:00–06:00.
- The dishwasher runs in 00:00–06:00.
- Concurrent planned load ≤ 9.6 kW at all times.
- `savingsCents > 0`.

Expected shape: washer now (5:30 PM), dryer 9–10 PM, dishwasher and car overnight. Sanity check: savings ≈ $7–8 on the demo rate. If you get something very different, inspect before "fixing" the test.

**Second scene (6:45 PM):** "We're heading out until 9." → away mode: TV, console, soundbar, office PC, printer, lights off; thermostat → 82; water heater eco; fridge/router/aquarium kept on; the running washer continues. `arriving` at 9 PM → pre-cooling starts at 9 PM, not earlier, because 8:30–9 PM is peak.

---

## 16. Hackathon deliverables (update continuously)

- **README.md:** what / why / how; "why it's different" (Section 2); Mermaid architecture; run locally with zero keys; env vars; MCP details (version, transport, tools table, resources, MCP App); AWS services and how they're used; screenshots; limitations; a statement of what was built during the hackathon window.
- **LICENSE** (MIT).
- **FEEDBACK.md** — for every tool/SDK used (MCP TypeScript SDK, MCP Inspector, ext-apps, OpenEI URDB, Bedrock, Lambda, DynamoDB, EventBridge Scheduler, CDK, Kiro if used): what we used it for, what worked, what needs work, onboarding experience, would we build with it again.
- **FRICTION_LOG.md** — one entry per issue:
  ```
  ### <short title>
  - Task attempted:
  - Steps taken:
  - Expected:
  - Actual:
  - Severity: blocker | major | minor
  - Workaround:
  - Suggestion:
  ```
- **FEATURE_REQUESTS.md** — each with why it matters and urgency (critical / important / nice-to-have):
  1. Let add-ons read Alexa occupancy and Hunches signals, with customer consent.
  2. Proactive announcements from add-ons ("the car is charged").
  3. Read the state of Alexa-connected smart home devices from an add-on.
  4. A public Alexa+ add-on simulator for developers outside the preview.
- **DEMO_SCRIPT.md** and **SUBMISSION.md** (draft Devpost text: problem, solution, how it works, tech, AWS usage, impact, what's next).
- **Open Source mini challenge:** public `tou-rates` repo (MIT) + its URL, our GitHub usernames, and a short "what, how, why it matters."

---

## 17. Demo video script (target 2:50, lead with the best moment)

| Time | Scene |
|---|---|
| 0:00–0:15 | Hook: "A cheap schedule is useless if the car's dead at 7 AM." Show the price strip with peak 4–9 PM. |
| 0:15–1:05 | 5:30 PM — "I need the car charged by 7, dishes and laundry done tonight, nothing loud after 10." Plan timeline appears; Alexa states the savings. User: "Do it." Inspector flashes `tools/call plan_tasks` → `apply_plan`. |
| 1:05–1:40 | 6:45 PM — "We're heading out until 9." Devices go dark in the house panel; fridge/router/aquarium stay lit. "Cooling starts at 9 when peak ends." |
| 1:40–2:00 | "Why did the TV turn off?" → `explain`. "Turn it back on" → `undo`. |
| 2:00–2:20 | Fast-forward to 7 AM: car at 80%, ledger fills in. "How much did Off-Peak save me today?" |
| 2:20–2:35 | Next evening: "It's just me in the office." Living room and bedroom go idle-off. Toggle voice-only mode to show it works without a screen. |
| 2:35–2:50 | Architecture + AWS services + "Rules > Presence > Price." Close on the savings number. |

Record in **scripted mode** if Bedrock is flaky; say so honestly in the submission.

---

## 18. Quality bar

- One command (`npm run dev`) starts everything; `npm test` passes; CI optional.
- No unhandled promise rejections; every tool error is speakable.
- Tool latency < 300 ms locally (excluding Bedrock).
- Never-off and ask-first enforced **server-side**; sim admin routes disabled unless `SIM_ADMIN=1`; no secrets in the client bundle; CORS limited to `WEB_ORIGIN`; Zod validation on every tool input.
- Structured JSON logs per tool call: `{ tool, ms, ok }`.

---

## 19. `.env.example`

```
PORT=8787
WEB_ORIGIN=http://localhost:5173
VITE_MCP_URL=http://localhost:8787/mcp
HOUSEHOLD_TZ=America/Los_Angeles
DEMO_ZIP=
TARIFF_SOURCE=demo          # demo | fixture | openei
OPENEI_API_KEY=
CLOCK=sim                   # sim | real
STORE=json                  # memory | json | dynamodb
SCHEDULER=local             # local | eventbridge
DEVICES=sim                 # sim | homeassistant
HA_URL=
HA_TOKEN=
LLM_MODE=mock               # mock | bedrock
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=
DDB_TABLE=OffPeak
EXECUTOR_LAMBDA_ARN=
SCHEDULER_ROLE_ARN=
SIM_ADMIN=1
```

Optional Home Assistant adapter: REST `GET /api/states` and `POST /api/services/<domain>/<service>` with `Authorization: Bearer <HA_TOKEN>`, mapping our device IDs to entity IDs via `fixtures/ha-map.json`.

---

## 20. Start now

Begin **Milestone 0**. Before writing code, print:
1. the file tree you'll create for M0,
2. the exact npm packages and versions you'll install (confirm `@modelcontextprotocol/sdk` is a v1.x release),
3. the commands to run the server, the tests, and the MCP Inspector.

Then implement M0, run the tests, and give me the 5-line summary.
