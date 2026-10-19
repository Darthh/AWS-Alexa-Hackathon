import { describe, expect, it } from "vitest";
import { requireDevice, resolveDevice, requireZone } from "./resolve.ts";
import { confirmRule, parseRuleText } from "./ruleParser.ts";
import { demoHome } from "./testing.ts";
import { iso, parseWhen } from "./time.ts";

const TZ = "America/Los_Angeles";
const NOW = "2026-10-19T17:30:00-07:00";
const at = (s: string | number) => {
  const t = parseWhen(s, NOW, TZ);
  return t === null ? null : iso(t, TZ);
};

describe("parseWhen", () => {
  it("parses clock times, words, and relative times", () => {
    expect(at("07:00")).toBe("2026-10-20T07:00:00-07:00");
    expect(at("21:30")).toBe("2026-10-19T21:30:00-07:00");
    expect(at("7am")).toBe("2026-10-20T07:00:00-07:00");
    expect(at("10 PM")).toBe("2026-10-19T22:00:00-07:00");
    expect(at("9")).toBe("2026-10-19T21:00:00-07:00"); // next of 9 AM / 9 PM
    expect(at("7")).toBe("2026-10-19T19:00:00-07:00");
    expect(at("tonight")).toBe("2026-10-20T07:00:00-07:00");
    expect(at("midnight")).toBe("2026-10-20T00:00:00-07:00");
    expect(at("in 2 hours")).toBe("2026-10-19T19:30:00-07:00");
    expect(at(20)).toBe("2026-10-19T17:50:00-07:00");
    expect(at("2026-10-20T06:00:00-07:00")).toBe("2026-10-20T06:00:00-07:00");
    expect(at("whenever")).toBeNull();
  });
});

describe("device and zone resolution", () => {
  const h = demoHome();
  it("resolves names, aliases, rooms, and typos", () => {
    expect(requireDevice(h, "the car").id).toBe("ev");
    expect(requireDevice(h, "fish tank").id).toBe("aquarium");
    expect(requireDevice(h, "living room TV").id).toBe("tv");
    expect(requireDevice(h, "dishwahser").id).toBe("dishwasher");
    expect(requireDevice(h, "office lamp").id).toBe("desk_lamp");
    expect(requireDevice(h, "living room lights").id).toBe("floor_lamp");
    expect(requireZone(h, "study").id).toBe("office");
  });
  it("asks when ambiguous and fails cleanly when unknown", () => {
    expect(resolveDevice(h, "lamp").kind).toBe("ambiguous");
    expect(() => requireDevice(h, "lamp")).toThrow(/^Which one did you mean: /);
    expect(resolveDevice(h, "hot tub").kind).toBe("none");
  });
});

describe("deterministic rule parser", () => {
  const h = demoHome();
  const cases: [string, object][] = [
    ["nothing loud after 10", { type: "quiet_hours", start: "22:00", end: "07:00" }],
    ["no noisy appliances between 9:30 pm and 6 am", { type: "quiet_hours", start: "21:30", end: "06:00" }],
    ["car charged by 7", { type: "deadline", deviceId: "ev", by: "07:00", targetPercent: 80 }],
    ["car at 90% by 6:30 am on weekdays", { type: "deadline", deviceId: "ev", by: "06:30", targetPercent: 90, days: ["mon", "tue", "wed", "thu", "fri"] }],
    ["make sure the dishwasher is done by 6", { type: "deadline", deviceId: "dishwasher", by: "06:00" }],
    ["never turn off the fish tank", { type: "never_off", deviceId: "aquarium" }],
    ["always keep the router on", { type: "never_off", deviceId: "router" }],
    ["ask me before turning off the TV", { type: "ask_first", deviceId: "tv" }],
    ["don't go over 8 kw", { type: "max_load", kw: 8 }],
    ["keep the office between 70 and 76 degrees", { type: "comfort", zoneId: "office", minF: 70, maxF: 76, when: "occupied" }],
  ];
  it.each(cases)("%s", (text, expected) => {
    expect(parseRuleText(text, h)).toMatchObject(expected);
  });
  it("returns null for non-rules", () => {
    expect(parseRuleText("what's the weather", h)).toBeNull();
  });
  it("confirms in speech", () => {
    expect(confirmRule(parseRuleText("nothing loud after 10", h)!, h)).toBe("Got it: nothing noisy will run between 10 PM and 7 AM.");
  });
});
