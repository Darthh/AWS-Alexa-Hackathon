import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, expectSpeakable, startTestServer, type TestServer } from "./helpers.ts";

describe("M1 tools: tariffs, prices, status", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startTestServer();
  });
  afterAll(async () => {
    await s.close();
  });

  it("lists all 17 tools with annotations and output schemas", async () => {
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_rule", "apply_plan", "arriving", "cancel_plan", "control_device", "explain", "find_cheapest_window", "find_rate_plans",
        "get_home_status", "get_price_now", "get_savings", "list_rules", "plan_tasks", "remove_rule", "select_rate_plan", "set_mode", "undo",
      ].sort(),
    );
    for (const t of tools) {
      expect(t.outputSchema, t.name).toBeDefined();
      expect(t.annotations?.readOnlyHint, t.name).toBeTypeOf("boolean");
    }
    const ui = tools.filter((t) => (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri === "ui://off-peak/plan.html");
    expect(ui.map((t) => t.name).sort()).toEqual(["get_home_status", "get_savings", "plan_tasks"]);
  });

  it("lists resources including the MCP App", async () => {
    const { resources } = await s.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(
      ["offpeak://household", "offpeak://ledger/today", "offpeak://tariff/current", "ui://off-peak/plan.html"].sort(),
    );
    const app = await s.client.readResource({ uri: "ui://off-peak/plan.html" });
    expect(app.contents[0]!.mimeType).toBe("text/html;profile=mcp-app");
    const tariff = await s.client.readResource({ uri: "offpeak://tariff/current" });
    expect(JSON.parse((tariff.contents[0] as { text: string }).text).rateId).toBe("DEMO_TOU");
  });

  it("find_rate_plans returns bundled plans offline, TOU first", async () => {
    const r = await call(s, "find_rate_plans", { zip: "94110" });
    expect(r.isError).toBe(false);
    expect(r.data.source).toBe("bundled");
    expect(r.data.plans.length).toBe(4);
    expect(r.data.plans.every((p: { isTou: boolean }) => p.isTou)).toBe(true);
    expect(r.text).toMatch(/best time-of-use match is PG&E/);
    expectSpeakable(r.text);
  });

  it("select_rate_plan switches tariffs and back", async () => {
    const r = await call(s, "select_rate_plan", { rateId: "69de71a5406310365e0f080d" });
    expect(r.data).toMatchObject({ utility: "Pacific Gas & Electric Co", isTou: true, isDemoRate: false });
    expect(r.data.warnings).toContain("Tiered pricing simplified to tier 1.");
    expect(r.text).toBe("Switched to PG&E E-TOU-C Residential Time of Use Baseline Region X. Peak 4–9 PM today; cheapest midnight–4 PM and 9 PM–midnight.");
    const price = await call(s, "get_price_now");
    expect(price.data).toMatchObject({ centsPerKwh: 31.617, periodName: "peak", isDemoRate: false });
    const back = await call(s, "select_rate_plan", { rateId: "demo" });
    expect(back.data.rateId).toBe("DEMO_TOU");
  });

  it("find_cheapest_window for the dishwasher and a generic block", async () => {
    const r = await call(s, "find_cheapest_window", { device: "dishes" });
    expect(r.data).toMatchObject({ device: "Dishwasher", start: "2026-10-20T00:00:00-07:00", end: "2026-10-20T02:00:00-07:00", costCents: 29, costIfNowCents: 59 });
    expect(r.text).toBe("The cheapest time to run the dishwasher is midnight–2 AM, about $0.30 less than doing it now on the demo rate.");
    const g = await call(s, "find_cheapest_window", { durationMinutes: 120, finishBy: "21:00" });
    expect(g.data.start).toBe("2026-10-19T17:30:00-07:00");
    expect(g.text).toMatch(/^Now is already the cheapest time/);
  });

  it("find_cheapest_window respects quiet hours for the dryer", async () => {
    const r = await call(s, "find_cheapest_window", { device: "dryer", finishBy: "tonight" });
    expect(r.data.start).toBe("2026-10-19T21:00:00-07:00");
  });

  it("get_home_status summarizes the home with a timeline", async () => {
    const r = await call(s, "get_home_status");
    expect(r.data).toMatchObject({ view: "home", mode: "home", priceNow: { centsPerKwh: 49, periodName: "peak" }, running: [], scheduled: [] });
    expect(r.data.activeZones).toEqual(expect.arrayContaining(["Kitchen", "Living room", "Office"]));
    expect(r.data.timeline.prices.length).toBeGreaterThanOrEqual(24);
    expect(r.data.timeline.quiet.length).toBeGreaterThan(0);
    expect(r.text).toBe("You're home. It's peak, 49 cents until 9 PM on the demo rate.");
  });

  it("returns speakable domain errors and clarifying questions", async () => {
    const bad = await call(s, "find_cheapest_window", { device: "toaster" });
    expect(bad.isError).toBe(true);
    expect(bad.data.error.code).toBe("not_found");
    expect(bad.text).toBe('I couldn\'t find an appliance called "toaster".');
    const amb = await call(s, "control_device", { device: "lamp", action: "off" });
    expect(amb.isError).toBe(true);
    expect(amb.data.error.code).toBe("ambiguous");
    expect(amb.text).toMatch(/^Which one did you mean: .* or /);
  });
});

describe("sim admin routes", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startTestServer();
  });
  afterAll(async () => {
    await s.close();
  });

  it("serves state, moves the clock, toggles motion, and resets", async () => {
    const state: any = await (await fetch(`${s.url}/sim/state`)).json();
    expect(state.household.devices.length).toBe(20);
    expect(state.clock.label).toBe("Mon 5:30 PM");
    expect(state.strip).toHaveLength(24);

    const clock: any = await (await fetch(`${s.url}/sim/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set", value: "21:00" }) })).json();
    expect(clock.local).toBe("2026-10-19T21:00:00-07:00");

    const motion: any = await (await fetch(`${s.url}/sim/motion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ zoneId: "bedroom", present: true }) })).json();
    expect(motion.occupancy.bedroom).toBe(true);

    const reset: any = await (await fetch(`${s.url}/sim/reset`, { method: "POST" })).json();
    expect(reset.clock.local).toBe("2026-10-19T17:30:00-07:00");
  });

  it("is disabled without SIM_ADMIN=1", async () => {
    const t = await startTestServer({ SIM_ADMIN: "0" });
    expect((await fetch(`${t.url}/sim/state`)).status).toBe(404);
    await t.close();
  });
});
