import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, expectSpeakable, jump, startTestServer, type TestServer } from "./helpers.ts";

const PROTECTED = ["fridge", "router", "aquarium"];

async function motion(s: TestServer, zoneId: string, present: boolean) {
  await fetch(`${s.url}/sim/motion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ zoneId, present }) });
}

describe("Scene 2: heading out at 6:45 PM until 9", () => {
  let s: TestServer;
  let tvEntry: string;
  beforeAll(async () => {
    s = await startTestServer();
    await call(s, "plan_tasks", {
      tasks: [{ device: "car" }, { device: "dishwasher", finishBy: "tonight" }, { device: "washer", finishBy: "tonight" }, { device: "dryer", finishBy: "tonight" }],
    });
    await call(s, "apply_plan", {});
    await jump(s, "2026-10-19T18:45:00-07:00");
    for (const z of ["kitchen", "living_room", "office"]) await motion(s, z, false);
  });
  afterAll(async () => {
    await s.close();
  });

  it("away mode turns off 6+ devices, keeps protected ones and the running washer", async () => {
    const before = await s.rt.household();
    const r = await call(s, "set_mode", { mode: "away", returnAt: "9" });
    expect(r.isError).toBe(false);
    const offs = r.data.actions.filter((a: { action: string }) => a.action === "off").map((a: { deviceId: string }) => a.deviceId);
    expect(offs.length).toBeGreaterThanOrEqual(6);
    expect(offs).toEqual(expect.arrayContaining(["tv", "console", "soundbar", "pc", "printer", "kitchen_lights", "floor_lamp"]));
    expect(r.data.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deviceId: "thermostat", action: "setback" }),
        expect.objectContaining({ deviceId: "water_heater", action: "eco" }),
      ]),
    );
    expect(r.data.keptOn.map((k: { deviceId: string }) => k.deviceId).sort()).toEqual(["aquarium", "fridge", "router", "washer"]);
    expect(r.data.arrival).toMatchObject({ preconditionAt: "2026-10-19T21:00:00-07:00", restoreAt: "2026-10-19T21:00:00-07:00" });
    expect(r.text).toBe(
      "Away mode is on: I turned off 10 things, but the fridge, Wi-Fi router, and aquarium stay on, and the washer keeps running. Cooling starts at 9 PM, when peak ends.",
    );
    expectSpeakable(r.text);

    const after = await s.rt.household();
    for (const id of PROTECTED) expect(after.devices.find((d) => d.id === id)!.state).toEqual(before.devices.find((d) => d.id === id)!.state);
    expect(after.devices.find((d) => d.id === "washer")!.state.running).toBe(true);
    expect(after.devices.find((d) => d.id === "thermostat")!.state.setpointF).toBe(82);
    const ledger = await s.rt.store.listLedger();
    expect(ledger.some((e) => PROTECTED.includes(e.deviceId ?? ""))).toBe(false);
  });

  it("explains why the TV turned off, and undo turns just the TV back on", async () => {
    const e = await call(s, "explain", { device: "TV" });
    expect(e.text).toBe("The TV turned off at 6:45 PM because you left home and it was drawing 15 W on standby. Say undo to reverse it.");
    tvEntry = e.data.entry.id;
    const u = await call(s, "undo", { actionId: tvEntry });
    expect(u.text).toBe("Done, the TV is back the way it was.");
    const h = await s.rt.household();
    expect(h.devices.find((d) => d.id === "tv")!.state).toMatchObject({ on: true, powerW: 15 });
    expect(h.devices.find((d) => d.id === "console")!.state.on).toBe(false);
    expect(h.mode).toBe("away");
  });

  it("at 9 PM pre-cooling starts (not during peak) and only Off-Peak's changes are restored", async () => {
    await jump(s, "2026-10-19T20:59:00-07:00");
    expect((await s.rt.household()).devices.find((d) => d.id === "thermostat")!.state.setpointF).toBe(82);
    await jump(s, "2026-10-19T21:00:00-07:00");
    const h = await s.rt.household();
    expect(h.mode).toBe("home");
    expect(h.devices.find((d) => d.id === "thermostat")!.state.setpointF).toBe(74);
    expect(h.devices.find((d) => d.id === "water_heater")!.state.ecoMode).toBe(false);
    for (const id of ["console", "soundbar", "pc", "printer", "kitchen_lights", "floor_lamp", "fan"]) {
      expect(h.devices.find((d) => d.id === id)!.state.on, id).toBe(true);
    }
    expect(h.devices.find((d) => d.id === "bedside_lamp")!.state.on).toBe(false); // was already off
    const ledger = await s.rt.store.listLedger();
    expect(ledger.filter((e) => e.deviceId === "tv" && e.action === "restore")).toHaveLength(0); // already undone
  });

  it("savings show shift + away", async () => {
    const r = await call(s, "get_savings", { period: "today" });
    expect(r.data.bySource.shift).toBeGreaterThan(0); // dryer at 9 PM
    expect(r.data.bySource.away).toBeGreaterThan(0);
    const est = await call(s, "get_savings", { period: "today", includeEstimates: true });
    expect(est.data.totalCents).toBeGreaterThan(r.data.totalCents);
    expectSpeakable(r.text);
  });
});

describe("idle-off, zone mode, sleep, protections, undo", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startTestServer();
  });
  afterAll(async () => {
    await s.close();
  });

  it("idle standby devices go off 30 minutes after people leave a room", async () => {
    await motion(s, "living_room", false);
    await jump(s, "2026-10-19T17:50:00-07:00");
    let h = await s.rt.household();
    expect(h.devices.find((d) => d.id === "tv")!.state.on).toBe(true);
    const status = await call(s, "get_home_status");
    expect(status.data.idleCandidates).toEqual([]);
    await jump(s, "2026-10-19T18:01:00-07:00");
    h = await s.rt.household();
    for (const id of ["tv", "console", "soundbar"]) expect(h.devices.find((d) => d.id === id)!.state.on, id).toBe(false);
    expect(h.devices.find((d) => d.id === "floor_lamp")!.state.on).toBe(true); // a light, not a standby load
    const ledger = await s.rt.store.listLedger();
    expect(ledger.filter((e) => e.source === "idle").map((e) => e.deviceId).sort()).toEqual(["console", "soundbar", "tv"]);
    expect(ledger.find((e) => e.source === "idle")!.at).toBe("2026-10-19T18:00:00-07:00");

    await jump(s, "2026-10-19T22:00:00-07:00");
    const sv = await call(s, "get_savings", { period: "today" });
    expect(sv.data.bySource.idle).toBeGreaterThan(0);
    expect(sv.text).toMatch(/switching off idle standby power/);
  });

  it("zone mode: just me in the office", async () => {
    await motion(s, "living_room", true);
    await call(s, "control_device", { device: "TV", action: "on" });
    const r = await call(s, "set_mode", { mode: "zone", activeZones: ["office"] });
    const off = r.data.actions.map((a: { deviceId: string }) => a.deviceId);
    expect(off).toEqual(expect.arrayContaining(["tv", "kitchen_lights", "speaker_plug", "fan"]));
    expect(off).not.toContain("pc");
    expect(off).not.toContain("thermostat");
    expect(r.text).toMatch(/^Okay, just the office: I turned off \d+ things in the other rooms, but the fridge stays on\.$/);
    const st = await call(s, "get_home_status");
    expect(st.text).toMatch(/^Only the office is in use/);
  });

  it("never-off devices need confirmation for direct requests", async () => {
    const r = await call(s, "control_device", { device: "fish tank", action: "off" });
    expect(r.data.needsConfirmation).toBe(true);
    expect(r.text).toBe("The aquarium is set to never turn off because it is protected. Are you sure you want it off?");
    expect((await s.rt.household()).devices.find((d) => d.id === "aquarium")!.state.on).toBe(true);
    const ok = await call(s, "control_device", { device: "fish tank", action: "off", confirm: true });
    expect(ok.data.after.on).toBe(false);
    await call(s, "control_device", { device: "aquarium", action: "on" });
  });

  it("undo with no id reverts the whole last mode change exactly", async () => {
    await call(s, "set_mode", { mode: "home" });
    const before = structuredClone((await s.rt.household()).devices.map((d) => ({ id: d.id, state: d.state })));
    await call(s, "set_mode", { mode: "away" });
    const u = await call(s, "undo", {});
    expect(u.text).toMatch(/^Done, I undid away mode and restored \d+ devices\.$/);
    const h = await s.rt.household();
    expect(h.mode).toBe("home");
    const after = h.devices.map((d) => ({ id: d.id, state: { ...d.state, lastActiveAt: undefined } }));
    expect(after).toEqual(before.map((d) => ({ id: d.id, state: { ...d.state, lastActiveAt: undefined } })));
  });

  it("sleep mode turns off lights outside the bedroom and holds noisy steps", async () => {
    await call(s, "control_device", { device: "bedside lamp", action: "on" });
    const r = await call(s, "set_mode", { mode: "sleep" });
    const off = r.data.actions.map((a: { deviceId: string }) => a.deviceId);
    expect(off).toEqual(expect.arrayContaining(["kitchen_lights", "floor_lamp", "tv"]));
    expect(off).not.toContain("bedside_lamp");
    expect(r.text).toMatch(/^Good night: I turned off/);
  });

  it("arriving: never pre-cools during peak", async () => {
    await jump(s, "2026-10-20T19:00:00-07:00");
    const r = await call(s, "arriving", { eta: 20 });
    expect(r.data.preconditionAt).toBe("2026-10-20T19:20:00-07:00");
    expect(r.text).toBe("Cooling starts when you get home at 7:20 PM, since it's peak until 9 PM. Everything else comes back on at 7:20 PM.");
  });
});

describe("rules", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startTestServer();
  });
  afterAll(async () => {
    await s.close();
  });

  it("adds, replaces, lists, and removes rules from plain language", async () => {
    const a = await call(s, "add_rule", { text: "never turn off the printer" });
    expect(a.text).toBe("Got it: I'll never turn off the printer.");
    const b = await call(s, "add_rule", { text: "car at 90% by 6:30 am on weekdays" });
    expect(b.data.replaced).toBe(true);
    expect(b.text).toBe("Got it: the car will be at 90% by 6:30 AM on weekdays.");
    const q = await call(s, "add_rule", { text: "nothing loud after 9:30pm" });
    expect(q.text).toBe("Got it: nothing noisy will run between 9:30 PM and 7 AM.");
    const l = await call(s, "add_rule", { text: "don't go over 8 kilowatts" });
    expect(l.data.rule.summary).toBe("stay under 8 kW");
    const ask = await call(s, "add_rule", { text: "ask me before turning off the TV" });
    expect(ask.data.rule.type).toBe("ask_first");

    const list = await call(s, "list_rules");
    expect(list.data.rules.length).toBe(9);
    expectSpeakable(list.text);

    const rm = await call(s, "remove_rule", { ruleId: "quiet hours" });
    expect(rm.text).toBe("Okay, I removed the rule: quiet hours 9:30 PM–7 AM.");
    const bad = await call(s, "add_rule", { text: "make me a sandwich" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/^I didn't catch that rule/);
  });

  it("ask-first devices are held back from automation", async () => {
    const r = await call(s, "set_mode", { mode: "away" });
    expect(r.data.needsConfirmation.map((n: { deviceId: string }) => n.deviceId)).toContain("tv");
    expect((await s.rt.household()).devices.find((d) => d.id === "tv")!.state.on).toBe(true);
  });
});
