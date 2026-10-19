import { DEMO_TOU } from "tou-rates";
import { describe, expect, it } from "vitest";
import { plan } from "./planner.ts";
import { demoHome } from "./testing.ts";
import { dailyIntervals, ms, overlaps } from "./time.ts";
import type { Plan, PlanStep, TaskRequest } from "./types.ts";

const TZ = "America/Los_Angeles";
const MON_1730 = "2026-10-19T17:30:00-07:00";
const TUE_0700 = "2026-10-20T07:00:00-07:00";

const stepsFor = (p: Plan, id: string) => p.steps.filter((s) => s.deviceId === id);
const one = (p: Plan, id: string): PlanStep => {
  const s = stepsFor(p, id);
  expect(s).toHaveLength(1);
  return s[0]!;
};
const hourOf = (isoStr: string) => Number(isoStr.slice(11, 13));

/** Max concurrent planned kW (+0.5 base) at any 15-minute instant. */
function peakLoad(p: Plan): number {
  const kwOf = (s: PlanStep) => s.kwh / ((ms(s.end) - ms(s.start)) / 3_600_000);
  let peak = 0;
  for (const t of p.steps.map((s) => ms(s.start))) {
    const kw = p.steps.filter((s) => ms(s.start) <= t && t < ms(s.end)).reduce((a, s) => a + kwOf(s), 0);
    peak = Math.max(peak, kw + 0.5);
  }
  return peak;
}

const GOLDEN_TASKS: TaskRequest[] = [
  { deviceId: "ev" },
  { deviceId: "dishwasher", finishBy: TUE_0700 },
  { deviceId: "washer", finishBy: TUE_0700 },
  { deviceId: "dryer", finishBy: TUE_0700 },
];

describe("golden scenario: weekday 5:30 PM, DEMO_TOU", () => {
  const h = demoHome();
  const p = plan(h, DEMO_TOU, MON_1730, GOLDEN_TASKS, h.rules, { id: "golden" });

  it("washer now, dryer 9–10 PM after the washer, before quiet hours", () => {
    const washer = one(p, "washer");
    const dryer = one(p, "dryer");
    expect(washer.start).toBe(MON_1730);
    expect(dryer.start).toBe("2026-10-19T21:00:00-07:00");
    expect(ms(dryer.end)).toBeLessThanOrEqual(ms("2026-10-19T22:00:00-07:00"));
    expect(ms(dryer.start)).toBeGreaterThanOrEqual(ms(washer.end));
    expect(dryer.reason).toBe("Peak ends at 9 PM; finishes at 10 PM, before quiet hours.");
    expect(washer.reason).toBe("Starts now so the dryer can finish before quiet hours at 10 PM; done by 7 PM.");
  });

  it("no noisy step overlaps 22:00–07:00", () => {
    const quiet = dailyIntervals("22:00", "07:00", ms(MON_1730), ms(TUE_0700) + 86_400_000, TZ);
    for (const s of p.steps.filter((x) => x.deviceId === "washer" || x.deviceId === "dryer")) {
      expect(overlaps(ms(s.start), ms(s.end), quiet)).toBe(false);
    }
  });

  it("EV reaches ≥ 80% by 07:00, charging only 00:00–06:00", () => {
    const ev = stepsFor(p, "ev");
    expect(ev.length).toBeGreaterThan(0);
    const kwh = ev.reduce((a, s) => a + s.kwh, 0);
    expect(35 + (kwh / 75) * 100).toBeGreaterThanOrEqual(80 - 1e-9);
    for (const s of ev) {
      expect(ms(s.start)).toBeGreaterThanOrEqual(ms("2026-10-20T00:00:00-07:00"));
      expect(ms(s.end)).toBeLessThanOrEqual(ms("2026-10-20T06:00:00-07:00"));
    }
    expect(ev.at(-1)!.end).toBe("2026-10-20T04:45:00-07:00");
  });

  it("dishwasher runs 00:00–06:00", () => {
    const dw = one(p, "dishwasher");
    expect(dw.start).toBe("2026-10-20T00:00:00-07:00");
    expect(ms(dw.end)).toBeLessThanOrEqual(ms("2026-10-20T06:00:00-07:00"));
    expect(dw.reason).toBe("Super off-peak starts at midnight; done by 2 AM.");
  });

  it("stays under the 9.6 kW load cap", () => {
    expect(peakLoad(p)).toBeLessThanOrEqual(9.6);
    expect(p.ruleChecks.find((c) => c.ruleId === "rule_max_load")).toMatchObject({ ok: true });
  });

  it("saves about $7.74 against running everything now", () => {
    expect(p.savingsCents).toBeGreaterThan(0);
    expect(p.costCents).toBe(957);
    expect(p.baselineCostCents).toBe(1731);
    expect(p.savingsCents).toBe(774);
    expect(p.conflicts).toEqual([]);
    expect(p.ruleChecks.every((c) => c.ok)).toBe(true);
  });

  it("is deterministic and fast", () => {
    const t0 = performance.now();
    const again = plan(h, DEMO_TOU, MON_1730, GOLDEN_TASKS, h.rules, { id: "golden" });
    expect(performance.now() - t0).toBeLessThan(50);
    expect(again).toEqual(p);
  });
});

describe("planner constraints", () => {
  it("meets a requested deadline", () => {
    const h = demoHome();
    const p = plan(h, DEMO_TOU, MON_1730, [{ deviceId: "dishwasher", finishBy: "2026-10-19T20:00:00-07:00" }]);
    expect(ms(one(p, "dishwasher").end)).toBeLessThanOrEqual(ms("2026-10-19T20:00:00-07:00"));
  });

  it("load cap keeps the dryer from overlapping full-power EV charging", () => {
    const h = demoHome();
    h.rules = h.rules.filter((r) => r.type !== "quiet_hours");
    const p = plan(h, DEMO_TOU, MON_1730, [{ deviceId: "ev" }, { deviceId: "dryer", finishBy: TUE_0700 }]);
    const dryer = one(p, "dryer");
    const fullPower = stepsFor(p, "ev").filter((s) => s.kwh / ((ms(s.end) - ms(s.start)) / 3_600_000) > 7.1);
    expect(fullPower.length).toBeGreaterThan(0);
    for (const ev of fullPower) {
      expect(overlaps(ms(dryer.start), ms(dryer.end), [[ms(ev.start), ms(ev.end)]])).toBe(false);
    }
    expect(hourOf(dryer.start)).toBeLessThan(6); // still super off-peak, just after the car
    expect(peakLoad(p)).toBeLessThanOrEqual(9.6);
  });

  it("without the load cap the dryer would share the cheapest slot with the car", () => {
    const h = demoHome();
    h.rules = h.rules.filter((r) => r.type !== "quiet_hours" && r.type !== "max_load");
    const p = plan(h, DEMO_TOU, MON_1730, [{ deviceId: "ev" }, { deviceId: "dryer", finishBy: TUE_0700 }]);
    expect(one(p, "dryer").start).toBe("2026-10-20T00:00:00-07:00");
  });

  it("EV picks the cheapest slots", () => {
    const h = demoHome();
    const p = plan(h, DEMO_TOU, MON_1730, [{ deviceId: "ev" }]);
    expect(stepsFor(p, "ev").every((s) => hourOf(s.start) < 6)).toBe(true);
    expect(p.costCents).toBe(810); // 33.75 kWh × 24¢
  });

  it("returns a conflict with priced options when quiet hours make laundry impossible", () => {
    const h = demoHome();
    const p = plan(h, DEMO_TOU, "2026-10-19T21:30:00-07:00", [
      { deviceId: "washer", finishBy: TUE_0700 },
      { deviceId: "dryer", finishBy: TUE_0700 },
    ]);
    const c = p.conflicts.find((x) => x.deviceId === "washer");
    expect(c).toBeDefined();
    expect(c!.message).toMatch(/quiet hours/);
    expect(c!.options.length).toBeGreaterThanOrEqual(2);
    expect(c!.options.length).toBeLessThanOrEqual(3);
    expect(c!.options[0]).toMatchObject({ change: { relaxRuleId: "rule_quiet" } });
    expect(c!.options.some((o) => "finishBy" in o.change)).toBe(true);
    expect(c!.options.every((o) => typeof o.extraCostCents === "number")).toBe(true);
    expect(p.steps.filter((s) => s.deviceId === "washer")).toHaveLength(0);
  });

  it("offers a lower charge target when the deadline is too close", () => {
    const h = demoHome();
    const p = plan(h, DEMO_TOU, "2026-10-20T04:00:00-07:00", [{ deviceId: "ev" }]);
    const c = p.conflicts[0]!;
    expect(c.deviceId).toBe("ev");
    // 3 h × 7.2 kW = 21.6 kWh → 35% + 28.8% → 60% (rounded down to 5%).
    expect(c.options.some((o) => o.label.startsWith("Charge to 60%"))).toBe(true);
  });

  it("relaxing a rule makes the conflict go away", () => {
    const h = demoHome();
    const p = plan(h, DEMO_TOU, "2026-10-19T21:30:00-07:00", [{ deviceId: "washer" }], h.rules, { relaxRuleIds: ["rule_quiet"] });
    expect(p.conflicts).toEqual([]);
    expect(one(p, "washer").start).toBe("2026-10-20T00:00:00-07:00");
  });

  it("handles the DST spring-forward night (EV fits in 5 super off-peak hours)", () => {
    const h = demoHome();
    // Sat Mar 7 2026 10 PM PST → Sun Mar 8 has no 2 AM. Deadline 7 AM Sunday via request.
    const p = plan(h, DEMO_TOU, "2026-03-07T22:00:00-08:00", [{ deviceId: "ev", finishBy: "2026-03-08T07:00:00-07:00" }]);
    const ev = stepsFor(p, "ev");
    expect(p.conflicts).toEqual([]);
    for (const s of ev) expect(ms(s.end)).toBeLessThanOrEqual(ms("2026-03-08T06:00:00-07:00"));
    const kwh = ev.reduce((a, s) => a + s.kwh, 0);
    expect(kwh).toBeCloseTo(33.75, 3);
    expect(p.costCents).toBe(810);
  });

  it("weekend (no peak) makes different choices than a weekday", () => {
    const h = demoHome();
    const sat = plan(h, DEMO_TOU, "2026-10-24T17:30:00-07:00", [
      { deviceId: "washer", finishBy: "2026-10-25T07:00:00-07:00" },
      { deviceId: "dryer", finishBy: "2026-10-25T07:00:00-07:00" },
    ]);
    expect(one(sat, "washer").start).toBe("2026-10-24T17:30:00-07:00");
    expect(one(sat, "dryer").start).toBe("2026-10-24T19:00:00-07:00");
    expect(sat.savingsCents).toBe(0);
  });

  it("skips an EV that is already at target", () => {
    const h = demoHome();
    h.devices.find((d) => d.id === "ev")!.battery!.socPercent = 85;
    const p = plan(h, DEMO_TOU, MON_1730, [{ deviceId: "ev" }]);
    expect(p.steps).toEqual([]);
    expect(p.ruleChecks.some((c) => /already at 85%/.test(c.note))).toBe(true);
  });

  it("rejects devices that can't be scheduled", () => {
    expect(() => plan(demoHome(), DEMO_TOU, MON_1730, [{ deviceId: "tv" }])).toThrow(/isn't an appliance/);
  });
});
