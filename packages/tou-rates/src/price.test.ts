import { describe, expect, it } from "vitest";
import { DEMO_TOU, describeDay, nextChange, priceAt, slots, summarize } from "./index.ts";

const LA = "America/Los_Angeles";
// Monday Oct 19 2026 is a weekday; Oct 24 is a Saturday.
const MON = (hhmm: string) => `2026-10-19T${hhmm}:00-07:00`;

describe("DEMO_TOU priceAt", () => {
  it("prices a weekday", () => {
    expect(priceAt(DEMO_TOU, MON("17:30"))).toMatchObject({ centsPerKwh: 49, periodName: "peak" });
    expect(priceAt(DEMO_TOU, MON("03:00"))).toMatchObject({ centsPerKwh: 24, periodName: "super off-peak" });
    expect(priceAt(DEMO_TOU, MON("21:00"))).toMatchObject({ centsPerKwh: 31, periodName: "off-peak" });
    expect(priceAt(DEMO_TOU, MON("15:59"))).toMatchObject({ centsPerKwh: 31 });
    expect(priceAt(DEMO_TOU, MON("16:00"))).toMatchObject({ centsPerKwh: 49 });
  });

  it("has no peak on weekends", () => {
    expect(priceAt(DEMO_TOU, "2026-10-24T17:30:00-07:00")).toMatchObject({ centsPerKwh: 31, periodName: "off-peak" });
  });

  it("reads local wall-clock hours regardless of the instant's offset", () => {
    // 00:30 UTC Tuesday = 17:30 PDT Monday → peak.
    expect(priceAt(DEMO_TOU, "2026-10-20T00:30:00Z").periodName).toBe("peak");
  });
});

describe("slots", () => {
  it("covers a normal day in 96 quarter-hours", () => {
    expect(slots(DEMO_TOU, "2026-10-19T00:00:00-07:00", "2026-10-20T00:00:00-07:00")).toHaveLength(96);
  });

  it("handles DST spring-forward (23-hour day)", () => {
    const s = slots(DEMO_TOU, "2026-03-08T00:00:00-08:00", "2026-03-09T00:00:00-07:00");
    expect(s).toHaveLength(92);
    // 02:00 local does not exist; the slot after 01:45 PST starts at 03:00 PDT.
    const i = s.findIndex((x) => x.start.startsWith("2026-03-08T01:45"));
    expect(s[i + 1]!.start).toBe("2026-03-08T03:00:00-07:00");
    expect(s.filter((x) => x.periodName === "super off-peak")).toHaveLength(5 * 4);
  });

  it("handles DST fall-back (25-hour day)", () => {
    const s = slots(DEMO_TOU, "2026-11-01T00:00:00-07:00", "2026-11-02T00:00:00-08:00");
    expect(s).toHaveLength(100);
    expect(s.filter((x) => x.periodName === "super off-peak")).toHaveLength(7 * 4);
  });

  it("prices each slot", () => {
    const s = slots(DEMO_TOU, MON("20:30"), MON("21:30"), 15);
    expect(s.map((x) => x.centsPerKwh)).toEqual([49, 49, 31, 31]);
  });
});

describe("describeDay / nextChange / summarize", () => {
  it("describes a weekday", () => {
    expect(describeDay(DEMO_TOU, "2026-10-19")).toBe("Peak 4–9 PM today; cheapest midnight–6 AM.");
  });

  it("describes a weekend day", () => {
    expect(describeDay(DEMO_TOU, "2026-10-24", "Saturday")).toBe("No peak Saturday; cheapest midnight–6 AM.");
  });

  it("describes DST days without crashing", () => {
    expect(describeDay(DEMO_TOU, "2026-03-08")).toBe("No peak today; cheapest midnight–6 AM.");
    expect(describeDay(DEMO_TOU, "2026-11-01")).toBe("No peak today; cheapest midnight–6 AM.");
  });

  it("finds the next price change", () => {
    expect(nextChange(DEMO_TOU, MON("17:30"))).toMatchObject({ at: MON("21:00"), periodName: "off-peak" });
    expect(nextChange(DEMO_TOU, MON("22:10"))).toMatchObject({ at: "2026-10-20T00:00:00-07:00", centsPerKwh: 24 });
  });

  it("summarizes a plan", () => {
    expect(summarize(DEMO_TOU, "2026-10-24T12:00:00-07:00")).toBe("Time-of-use, 24–49¢/kWh; peak 4–9 PM weekdays.");
  });

  it("uses the tariff timezone", () => {
    expect(DEMO_TOU.timezone).toBe(LA);
  });
});
