import { describe, expect, it } from "vitest";
import { routeUtterance } from "./intents.ts";

const call = (u: string, ctx = {}) => routeUtterance(u, ctx).calls[0];

describe("scripted intent router (demo script lines)", () => {
  it("plans the golden request", () => {
    expect(call("I need the car charged by 7, dishes and laundry done tonight, nothing loud after 10.")).toEqual({
      tool: "plan_tasks",
      args: {
        tasks: [
          { device: "car", finishBy: "07:00" },
          { device: "dishwasher", finishBy: "tonight" },
          { device: "washer", finishBy: "tonight" },
          { device: "dryer", finishBy: "tonight" },
        ],
      },
    });
  });

  it.each([
    ["Do it.", "apply_plan", {}],
    ["We're heading out until 9.", "set_mode", { mode: "away", returnAt: "9" }],
    ["Why did the TV turn off?", "explain", { device: "tv" }],
    ["How much did Off-Peak save me today?", "get_savings", { period: "today" }],
    ["It's just me in the office.", "set_mode", { mode: "zone", activeZones: ["office"] }],
    ["We're back!", "set_mode", { mode: "home" }],
    ["Good night", "set_mode", { mode: "sleep" }],
    ["I'll be home in 20 minutes", "arriving", { eta: 20 }],
    ["What's the price right now?", "get_price_now", {}],
    ["When's the cheapest time to run the dishwasher?", "find_cheapest_window", { device: "dishwasher" }],
    ["What's going on at home?", "get_home_status", {}],
    ["Find my rate plan, I'm in 94110", "find_rate_plans", { zip: "94110" }],
    ["Never turn off the fish tank", "add_rule", { text: "Never turn off the fish tank" }],
    ["Turn off the printer", "control_device", { device: "printer", action: "off" }],
    ["Turn the office PC back on", "control_device", { device: "office pc", action: "on" }],
    ["Set the thermostat to 76", "control_device", { device: "thermostat", action: "set", value: 76 }],
    ["Cancel the dishwasher", "cancel_plan", { device: "dishwasher" }],
    ["Charge the car to 90% by 6:30", "plan_tasks", { tasks: [{ device: "car", finishBy: "06:30", targetPercent: 90 }] }],
  ])("%s", (utterance, tool, args) => {
    expect(call(utterance)).toEqual({ tool, args });
  });

  it("'turn it back on' undoes the explained action", () => {
    expect(call("Turn it back on", { lastEntryId: "act_42" })).toEqual({ tool: "undo", args: { actionId: "act_42" } });
    expect(call("Undo that")).toEqual({ tool: "undo", args: {} });
  });

  it("picks a rate plan from context", () => {
    expect(call("use the second one", { ratePlans: [{ rateId: "a", name: "A" }, { rateId: "b", name: "B" }] })).toEqual({
      tool: "select_rate_plan",
      args: { rateId: "b" },
    });
  });

  it("falls back politely", () => {
    const r = routeUtterance("tell me a joke");
    expect(r.calls).toEqual([]);
    expect(r.fallback).toMatch(/^Sorry/);
  });
});
