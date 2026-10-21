import { DEMO_TOU } from "tou-rates";
import { describe, expect, it } from "vitest";
import { lowerFirst, money, speakable } from "./format.ts";
import { isSchedulable } from "./household.ts";
import { routeUtterance } from "./intents.ts";
import { computeSavings } from "./savings.ts";
import type { LedgerEntry } from "./types.ts";
import { plan } from "./planner.ts";
import { planArrival, planModeChange } from "./presence.ts";
import { requireDevice, resolveDevice } from "./resolve.ts";
import { parseRuleText } from "./ruleParser.ts";
import { describePlan } from "./speech.ts";
import { demoHome } from "./testing.ts";
import { iso, ms } from "./time.ts";

const TZ = "America/Los_Angeles";
const MON_1730 = "2026-10-19T17:30:00-07:00";

describe("speech helpers", () => {
  it("speaks units instead of symbols", () => {
    expect(speakable("Super off-peak at 24¢/kWh; stay under 9.6 kW; 15 W on standby; 68–78°F; quiet hours 10 PM–7 AM")).toBe(
      "Super off-peak at 24 cents a kilowatt-hour; stay under 9.6 kilowatts; 15 watts on standby; 68 to 78 degrees; quiet hours 10 PM to 7 AM",
    );
    expect(speakable("Go over the 9.6 kW limit briefly")).toBe("Go over the 9.6-kilowatt limit briefly");
    expect(speakable("Here's the plan: about $7.74 cheaper")).toBe("Here's the plan: about $7.74 cheaper");
    expect(speakable("Switched to Rate E-1 – Residential. Peak 4–9 PM today; cheapest midnight–4 PM and 9 PM–midnight.")).toBe(
      "Switched to Rate E-1 – Residential. Peak 4 to 9 PM today; cheapest midnight to 4 PM and 9 PM to midnight.",
    );
    expect(speakable("1 kWh at 1¢, Plan 2W")).toBe("1 kilowatt-hour at 1 cent, Plan 2W");
  });

  it("says small amounts in cents", () => {
    expect(money(30)).toBe("30 cents");
    expect(money(1)).toBe("1 cent");
    expect(money(774)).toBe("$7.74");
  });

  it("keeps 'I' and acronyms when lowercasing a sentence start", () => {
    expect(lowerFirst("I can't fit the dryer")).toBe("I can't fit the dryer");
    expect(lowerFirst("TV needs your okay")).toBe("TV needs your okay");
    expect(lowerFirst("Allow it during quiet hours")).toBe("allow it during quiet hours");
  });
});

describe("device matching never swaps one short name for another device", () => {
  const h = demoHome();
  it("'tv' is not a typo of 'ev', and 'light' is not a typo of 'night'", () => {
    expect(resolveDevice(h, "tv")).toMatchObject({ kind: "ok", item: { id: "tv" } });
    expect(resolveDevice(h, "tv", isSchedulable).kind).toBe("none");
    expect(resolveDevice(h, "light").kind).toBe("ambiguous");
    expect(() => requireDevice(h, "tv", isSchedulable, "appliance")).toThrow(
      "The TV isn't an appliance I can schedule. I can plan the car, the washer, the dryer, or the dishwasher.",
    );
  });
  it("real misspellings, swapped letters, plurals and aliases still resolve", () => {
    for (const [ref, id] of [["wahser", "washer"], ["frigde", "fridge"], ["termostat", "thermostat"], ["televison", "tv"], ["tvs", "tv"], ["fans", "fan"]]) {
      expect(requireDevice(h, ref!).id).toBe(id);
    }
    expect(requireDevice(h, "dishwahser").id).toBe("dishwasher");
    expect(requireDevice(h, "night light").id).toBe("bedside_lamp");
    expect(requireDevice(h, "telly").id).toBe("tv");
  });
});

describe("conflict options", () => {
  const h = demoHome();
  it("a too-soon deadline gets the earliest and the cheapest later finish, priced", () => {
    const p = plan(h, DEMO_TOU, MON_1730, [{ deviceId: "dishwasher", finishBy: "2026-10-19T18:00:00-07:00" }]);
    const c = p.conflicts[0]!;
    expect(c.options.map((o) => o.label)).toEqual(["Finish by 7:30 PM instead (+$0.30)", "Finish by 2 AM tomorrow instead"]);
    expect(c.options.map((o) => o.extraCostCents)).toEqual([30, 0]);
    expect(describePlan(p, h, ms(MON_1730), { demoRate: true })).toBe(
      "I can't fit the dishwasher by 6 PM. Should I finish by 7:30 PM instead or by 2 AM tomorrow?",
    );
  });
  it("late laundry: quiet hours first, then a finish time with a day word; the dryer inherits the rule option", () => {
    const tue7 = "2026-10-20T07:00:00-07:00";
    const p = plan(h, DEMO_TOU, "2026-10-19T21:30:00-07:00", [
      { deviceId: "washer", finishBy: tue7 },
      { deviceId: "dryer", finishBy: tue7 },
    ]);
    const washer = p.conflicts.find((c) => c.deviceId === "washer")!;
    expect(washer.options[0]!.label).toBe("Allow it during quiet hours");
    // The finish time covers the pair: washer 7–8:30 AM after quiet hours, then the dryer until 9:30 AM.
    expect(washer.options[1]!.label).toMatch(/^Finish by 9:30 AM tomorrow instead/);
    const dryer = p.conflicts.find((c) => c.deviceId === "dryer")!;
    expect(dryer.options.length).toBeGreaterThanOrEqual(1);
    expect(dryer.options.every((o) => "relaxRuleId" in o.change)).toBe(true);
    // Accepting that option for the laundry actually produces a plan (no repeat of the same offer).
    const later = (washer.options[1]!.change as { finishBy: string }).finishBy;
    const retry = plan(h, DEMO_TOU, "2026-10-19T21:30:00-07:00", [
      { deviceId: "washer", finishBy: later },
      { deviceId: "dryer", finishBy: later },
    ]);
    expect(retry.conflicts).toEqual([]);
    expect(retry.steps.map((s) => [s.deviceId, s.start.slice(11, 16)])).toEqual([
      ["washer", "07:00"],
      ["dryer", "08:30"],
    ]);
  });
  it("an EV that can't reach its target is told so plainly", () => {
    const p = plan(h, DEMO_TOU, "2026-10-20T04:00:00-07:00", [{ deviceId: "ev" }]);
    expect(p.conflicts[0]!.message).toBe("I can't charge the car to 80% by 7 AM.");
    expect(p.conflicts[0]!.options[0]!.label).toBe("Charge to 60% instead of 80%");
  });
  it("plans five tasks well under 50 ms, cold", () => {
    const h5 = demoHome();
    h5.devices.push({ ...structuredClone(h5.devices.find((d) => d.id === "dishwasher")!), id: "dw2", name: "Second dishwasher", aliases: [] });
    const tue7 = "2026-10-20T07:00:00-07:00";
    const tasks = ["ev", "dishwasher", "washer", "dryer", "dw2"].map((deviceId) => ({ deviceId, ...(deviceId === "ev" ? {} : { finishBy: tue7 }) }));
    const t0 = performance.now();
    const p = plan(h5, DEMO_TOU, MON_1730, tasks);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(p.conflicts).toEqual([]);
    expect(new Set(p.steps.map((s) => s.deviceId)).size).toBe(5);
  });
});

describe("presence edge cases", () => {
  const h = demoHome();
  it("an arrival just after peak starts waits for the ETA instead of cooling into peak", () => {
    const a = planArrival(h, DEMO_TOU, ms("2026-10-19T15:00:00-07:00"), ms("2026-10-19T16:15:00-07:00"));
    expect(iso(a.preconditionAt, TZ)).toBe("2026-10-19T16:15:00-07:00");
    expect(a.note).toBe("Cooling starts when you get home at 4:15 PM, since it's peak until 9 PM.");
  });
  it("an arrival before peak pre-cools 30 minutes ahead", () => {
    const a = planArrival(h, DEMO_TOU, ms("2026-10-19T12:00:00-07:00"), ms("2026-10-19T15:30:00-07:00"));
    expect(iso(a.preconditionAt, TZ)).toBe("2026-10-19T15:00:00-07:00");
    expect(a.reason).toBe("you were due home at 3:30 PM");
  });
  it("zone mode sets back a thermostat that serves only an empty room", () => {
    const hz = demoHome();
    hz.devices.find((d) => d.id === "thermostat")!.zoneId = "office";
    const mp = planModeChange(hz, "zone", { activeZones: ["kitchen"] });
    expect(mp.actions.find((a) => a.deviceId === "thermostat")?.action).toBe("setback");
    const shared = planModeChange(demoHome(), "zone", { activeZones: ["kitchen"] });
    expect(shared.actions.find((a) => a.deviceId === "thermostat")).toBeUndefined();
  });
});

describe("rules people actually say", () => {
  const h = demoHome();
  it("'never run the dryer after 9pm' becomes a dryer deadline", () => {
    expect(parseRuleText("never run the dryer after 9pm", h)).toEqual({ type: "deadline", deviceId: "dryer", by: "21:00" });
    expect(parseRuleText("don't run the dryer after 9 pm", h)).toEqual({ type: "deadline", deviceId: "dryer", by: "21:00" });
    expect(parseRuleText("never run anything loud after 10", h)).toMatchObject({ type: "quiet_hours", start: "22:00" });
    // Opposite meaning, and the car's richer charge-by rule, are not captured by this phrasing.
    expect(parseRuleText("don't start the dryer until after 10", h)?.type).not.toBe("deadline");
    expect(parseRuleText("never start the car after 11 pm", h)).toBeNull();
  });
  it("scripted mode routes standing rules and removals to the rule tools", () => {
    expect(routeUtterance("Never run the dryer after 9pm").calls).toEqual([{ tool: "add_rule", args: { text: "Never run the dryer after 9pm" } }]);
    expect(routeUtterance("Remove the load limit").calls).toEqual([{ tool: "remove_rule", args: { ruleId: "load limit" } }]);
  });
});

describe("savings periods", () => {
  it("a plan that straddles the start of the week counts the same for today and this week", () => {
    const h = demoHome();
    const step = (at: string, cents: number): LedgerEntry => ({
      id: `led_${at}`, at, deviceId: "ev", action: "charge", reason: "cheapest", source: "plan",
      estSavedCents: cents, estimate: false, meta: { planId: "plan_x" },
    });
    // Sunday 11 PM and Monday 2 AM; the week (and the day) starts Monday at midnight.
    const ledger = [step("2026-10-18T23:00:00-07:00", 40), step("2026-10-19T02:00:00-07:00", 60)];
    const now = ms("2026-10-19T08:00:00-07:00");
    const today = computeSavings(h, DEMO_TOU, ledger, now, "today");
    const week = computeSavings(h, DEMO_TOU, ledger, now, "week");
    expect(today.totalCents).toBe(100);
    expect(week.totalCents).toBe(100);
    expect(today.includesEarlierPlanSteps).toBe(true);
  });
});
