import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, expectSpeakable, jump, startTestServer, type TestServer } from "./helpers.ts";

/**
 * Regressions found in the pre-submission audit: things a judge would hear or see on camera.
 * Every reply here must still meet the speech contract (≤ 2 sentences, no IDs, no symbols).
 */
const noSymbols = (text: string) => expect(text).not.toMatch(/¢|°F|\bkW\b|–|MCP error|-32602/);

describe("voice-safe errors and device matching", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startTestServer();
  });
  afterAll(async () => {
    await s.close();
  });

  it("schema failures are spoken, not raw SDK validation text", async () => {
    const r = await call(s, "find_rate_plans", { zip: "abc" });
    expect(r.isError).toBe(true);
    expect(r.text).toBe("I need a five-digit ZIP code to look up rate plans.");
    expect((r.data as { error: { code: string } }).error.code).toBe("invalid_input");
    const m = await call(s, "set_mode", { mode: "vacation" });
    expect(m.text).toMatch(/^Tell me whether you're heading out/);
    noSymbols(m.text);
  });

  it("malformed JSON on /mcp is a JSON-RPC parse error", async () => {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 } });
  });

  it("never silently swaps a short name for a different device", async () => {
    const tv = await call(s, "plan_tasks", { tasks: [{ device: "tv" }] });
    expect(tv.isError).toBe(true);
    expect(tv.text).toBe("The TV isn't an appliance I can schedule. I can plan the car, the washer, the dryer, or the dishwasher.");
    const light = await call(s, "control_device", { device: "light", action: "off" });
    expect(light.isError).toBe(true);
    expect(light.text).toMatch(/^Which one did you mean: the kitchen lights, the floor lamp/);
    expect((await s.rt.household()).devices.find((d) => d.id === "bedside_lamp")!.state.on).toBe(false);
  });

  it("conflicts offer at least two priced ways forward, with day words", async () => {
    const r = await call(s, "plan_tasks", { tasks: [{ device: "dishwasher", finishBy: "6 PM" }] });
    const c = r.data.conflicts[0];
    expect(c.options.length).toBeGreaterThanOrEqual(2);
    expect(c.options.every((o: { extraCostCents: unknown }) => typeof o.extraCostCents === "number")).toBe(true);
    expect(r.text).toBe("I can't fit the dishwasher by 6 PM. Should I finish by 7:30 PM instead or by 2 AM tomorrow?");
    expectSpeakable(r.text);
  });

  it("explaining a scheduled charge names the demo rate and speaks units", async () => {
    await call(s, "plan_tasks", { tasks: [{ device: "car" }] });
    await call(s, "apply_plan", {});
    const e = await call(s, "explain", { device: "car" });
    expect(e.text).toContain("24 cents a kilowatt-hour on the demo rate");
    noSymbols(e.text);
    expectSpeakable(e.text);
  });

  it("arriving while already home doesn't promise to turn things back on", async () => {
    const r = await call(s, "arriving", { eta: "8 PM" });
    expect(r.text).toBe("Cooling starts when you get home at 8 PM, since it's peak until 9 PM.");
  });
});

describe("rules, ask-first, and targeted undo", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startTestServer({}, "2026-10-19T18:45:00-07:00");
  });
  afterAll(async () => {
    await s.close();
  });

  it("parses 'never run the dryer after 9pm' as a dryer deadline", async () => {
    const r = await call(s, "add_rule", { text: "never run the dryer after 9pm" });
    expect(r.isError).toBe(false);
    expect(r.data.rule.type).toBe("deadline");
    expect(r.text).toBe("Got it: the dryer will be done by 9 PM.");
  });

  it("lists every rule it counts, in spoken units", async () => {
    await call(s, "add_rule", { text: "ask me before turning off the TV" });
    const r = await call(s, "list_rules");
    const n = r.data.rules.length;
    expect(r.text).toMatch(new RegExp(`^You have ${n} rules: `));
    expect(r.text).toContain("ask before turning off the TV");
    expect(r.text).toContain("68 to 78 degrees when someone's home");
    expect(r.text).toContain("stay under 9.6 kilowatts");
    noSymbols(r.text);
  });

  it("removes a rule by the words people use ('the load limit')", async () => {
    const r = await call(s, "remove_rule", { ruleId: "the load limit" });
    expect(r.isError).toBe(false);
    expect(r.data.removed.type).toBe("max_load");
    expect(r.text).toBe("Okay, I removed the rule: stay under 9.6 kilowatts.");
  });

  it("'remove the temperature rule' means the comfort range, not a thermostat device rule", async () => {
    await call(s, "add_rule", { text: "ask me before turning off the thermostat" });
    const r = await call(s, "remove_rule", { ruleId: "the temperature rule" });
    expect(r.data.removed.type).toBe("comfort");
    await call(s, "remove_rule", { ruleId: "ask first for the thermostat" });
  });

  it("asks about ask-first devices even when an arrival time is given", async () => {
    const r = await call(s, "set_mode", { mode: "away", returnAt: "9" });
    expect(r.data.needsConfirmation.map((n: { deviceId: string }) => n.deviceId)).toEqual(["tv"]);
    expect(r.text).toMatch(/The TV is set to ask first; should I turn it off too\?$/);
    expectSpeakable(r.text);
    expect(r.data.arrival.preconditionAt).toBe("2026-10-19T21:00:00-07:00");
  });

  it("'turn the TV back on' undoes only that device, not the whole away mode", async () => {
    await call(s, "set_mode", { mode: "away", returnAt: "9", confirm: true });
    const before = (await s.rt.household()).devices.filter((d) => !d.state.on).map((d) => d.id);
    expect(before).toContain("tv");
    const u = await call(s, "undo", { device: "TV" });
    expect(u.text).toBe("Done, the TV is back the way it was.");
    const h = await s.rt.household();
    expect(h.devices.find((d) => d.id === "tv")!.state.on).toBe(true);
    expect(h.mode).toBe("away");
    expect(h.devices.filter((d) => !d.state.on).map((d) => d.id)).toEqual(before.filter((id) => id !== "tv"));
  });
});

describe("sleep mode holds noisy appliances", () => {
  let s: TestServer;
  beforeAll(async () => {
    // Saturday morning: no peak, quiet hours ended at 7 AM, so only sleep mode can hold the washer.
    s = await startTestServer({}, "2026-10-24T08:00:00-07:00");
  });
  afterAll(async () => {
    await s.close();
  });

  it("a scheduled washer step is held, recorded, and explainable", async () => {
    const p = await call(s, "plan_tasks", { tasks: [{ device: "washer", earliestStart: "9 AM" }] });
    expect(p.data.steps[0].start).toBe("2026-10-24T09:00:00-07:00");
    await call(s, "apply_plan", {});
    await call(s, "set_mode", { mode: "sleep" });
    await jump(s, "2026-10-24T09:15:00-07:00");
    const h = await s.rt.household();
    expect(h.devices.find((d) => d.id === "washer")!.state.running).toBeFalsy();
    const held = (await s.rt.store.listLedger()).find((e) => e.deviceId === "washer" && e.action === "held");
    expect(held).toBeDefined();
    const e = await call(s, "explain", { actionId: held!.id });
    expect(e.text).toBe("The washer was held at 9 AM because sleep mode keeps noisy appliances off.");
  });
});
