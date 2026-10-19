import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, expectSpeakable, jump, startTestServer, type TestServer } from "./helpers.ts";

/**
 * Golden scenario (SPEC §15), end to end over MCP: weekday 5:30 PM on DEMO_TOU.
 * "Car to 80% by 7 AM, dishes and laundry tonight, nothing loud after 10."
 */
describe("golden scenario over MCP", () => {
  let s: TestServer;
  let planId: string;

  beforeAll(async () => {
    s = await startTestServer();
  });
  afterAll(async () => {
    await s.close();
  });

  it("plan_tasks proposes washer now, dryer 9 PM, dishwasher and car overnight, ~$7.74 cheaper", async () => {
    const r = await call(s, "plan_tasks", {
      tasks: [
        { device: "the car" },
        { device: "dishes", finishBy: "tonight" },
        { device: "washer", finishBy: "tonight" },
        { device: "dryer", finishBy: "tonight" },
      ],
    });
    expect(r.isError).toBe(false);
    planId = r.data.id;
    expect(r.data).toMatchObject({ view: "plan", status: "proposed", costCents: 957, baselineCostCents: 1731, savingsCents: 774, conflicts: [] });
    expect(r.text).toBe(
      "Here's the plan: the washer now, the dryer at 9 PM, and the dishwasher and the car overnight, about $7.74 cheaper than running it all now on the demo rate. Should I go ahead?",
    );
    expectSpeakable(r.text);
    expect(r.data.timeline.rows.map((x: { name: string }) => x.name).sort()).toEqual(["Car", "Dishwasher", "Dryer", "Washer"]);
    expect(r.data.ruleChecks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });

  it("apply_plan schedules it and starts the washer immediately (idempotent)", async () => {
    const r = await call(s, "apply_plan", { planId });
    expect(r.data.status).toBe("applied");
    expect(r.data.scheduledSteps).toHaveLength(5);
    expect(r.text).toBe("Done, it's all scheduled. The washer is starting now, and the car will be at 80% by 4:45 AM.");
    const again = await call(s, "apply_plan", { planId });
    expect(again.data.scheduledSteps).toHaveLength(5);

    const status = await call(s, "get_home_status");
    expect(status.data.running.map((x: { name: string }) => x.name)).toEqual(["Washer"]);
    expect(status.data.scheduled.map((x: { name: string }) => x.name)).toEqual(["Dryer", "Dishwasher", "Car", "Car"]);
    expect(status.text).toMatch(/^You're home; the washer is running and 3 things are scheduled, next the dryer at 9 PM\./);
  });

  it("runs the dryer at 9 PM after the washer finished", async () => {
    await jump(s, "2026-10-19T21:05:00-07:00");
    const h = await s.rt.household();
    expect(h.devices.find((d) => d.id === "washer")!.state.running).toBe(false);
    expect(h.devices.find((d) => d.id === "dryer")!.state).toMatchObject({ running: true, powerW: 3000 });
  });

  it("explains why the dishwasher waits until midnight", async () => {
    const r = await call(s, "explain", { device: "dishwasher" });
    expect(r.text).toBe("The dishwasher is scheduled for midnight: super off-peak starts at midnight; done by 2 AM.");
  });

  it("by 7 AM the car is at 80%, the ledger filled in, and savings are counted", async () => {
    await jump(s, "2026-10-20T07:00:00-07:00");
    const h = await s.rt.household();
    const ev = h.devices.find((d) => d.id === "ev")!;
    expect(ev.battery!.socPercent).toBe(80);
    expect(ev.state.running).toBe(false);
    expect(h.devices.find((d) => d.id === "dishwasher")!.state.running).toBe(false);

    const ledger = await s.rt.store.listLedger();
    const actions = ledger.map((e) => `${e.deviceId ?? "-"}:${e.action}`);
    expect(actions).toEqual(
      expect.arrayContaining(["-:plan applied", "washer:run", "dryer:run", "ev:charge", "dishwasher:run", "ev:charged"]),
    );
    expect(ledger.find((e) => e.deviceId === "ev" && e.action === "charge")!.at).toBe("2026-10-20T00:00:00-07:00");

    const savings = await call(s, "get_savings", { period: "today" });
    // Today (since midnight): the car and dishwasher shifts: 690 + 30 cents.
    expect(savings.data.bySource.shift).toBe(720);
    expect(savings.text).toBe("Off-Peak saved you about $7.20 today on the demo rate. Most of it came from running things off-peak.");
    const week = await call(s, "get_savings", { period: "week" });
    expect(week.data.bySource.shift).toBe(774);
  });
});

describe("plan lifecycle", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startTestServer();
  });
  afterAll(async () => {
    await s.close();
  });

  it("a conflict comes back with options, and picking one re-plans", async () => {
    await jump(s, "2026-10-19T21:30:00-07:00");
    const r = await call(s, "plan_tasks", { tasks: [{ device: "washer", finishBy: "tonight" }] });
    expect(r.data.steps).toHaveLength(0);
    expect(r.data.conflicts[0].message).toBe("I can't fit the washer before quiet hours start at 10 PM.");
    expect(r.text).toBe("I can't fit the washer before quiet hours start at 10 PM. Should I allow it during quiet hours or finish by 7 PM instead?");
    const relaxed = await call(s, "plan_tasks", { tasks: [{ device: "washer", finishBy: "tonight" }], relaxRules: ["rule_quiet"] });
    expect(relaxed.data.steps[0].start).toBe("2026-10-20T00:00:00-07:00");
  });

  it("cancel_plan by device stops future steps; a newer plan supersedes older steps", async () => {
    const p1 = await call(s, "plan_tasks", { tasks: [{ device: "dishwasher" }, { device: "car" }] });
    await call(s, "apply_plan", { planId: p1.data.id });
    const c = await call(s, "cancel_plan", { device: "dishwasher" });
    expect(c.text).toBe("Okay, I cancelled the dishwasher.");
    expect(c.data.devices).toEqual(["Dishwasher"]);

    const p2 = await call(s, "plan_tasks", { tasks: [{ device: "car", targetPercent: 60 }] });
    await call(s, "apply_plan", {});
    const jobs = await s.rt.store.listJobs();
    const pending = jobs.filter((j) => j.status === "pending" && j.kind === "step_start");
    expect(new Set(pending.map((j) => j.planId))).toEqual(new Set([p2.data.id]));
  });

  it("apply_plan with nothing proposed is a speakable error", async () => {
    const r = await call(s, "apply_plan", { planId: "nope" });
    expect(r.isError).toBe(true);
    expectSpeakable(r.text);
  });
});
