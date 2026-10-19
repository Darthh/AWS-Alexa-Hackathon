import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  demoTou,
  describeDay,
  fetchRatePlans,
  type FetchLike,
  normalize,
  type OpenEIRate,
  priceAt,
  summarize,
} from "./index.ts";

const fixture = (name: string): OpenEIRate =>
  (JSON.parse(readFileSync(new URL(`../../../fixtures/tariffs/${name}`, import.meta.url), "utf8")) as { items: OpenEIRate[] }).items[0]!;

const OCT_WEEKDAY = "2026-10-19";

describe("normalize (real OpenEI fixtures)", () => {
  it("PG&E E-TOU-C: tier-1 prices, 4–9 PM peak, tier warning, $/day fixed charge", () => {
    const t = normalize(fixture("pge-e-tou-c-region-x.json"));
    expect(t).toMatchObject({ rateId: "69de71a5406310365e0f080d", utility: "Pacific Gas & Electric Co", isTou: true, source: "openei" });
    expect(t.periods.map((p) => p.centsPerKwh)).toEqual([44.1, 31.8, 31.617, 28.617]);
    expect(t.warnings).toContain("Tiered pricing simplified to tier 1.");
    expect(t.fixedMonthlyCents).toBe(2413); // 0.79343 $/day × 365/12
    expect(describeDay(t, OCT_WEEKDAY)).toBe("Peak 4–9 PM today; cheapest midnight–4 PM and 9 PM–midnight.");
    expect(priceAt(t, "2026-07-15T17:00:00-07:00")).toMatchObject({ centsPerKwh: 44.1, periodName: "peak" });
  });

  it("PG&E EV2: three levels per month → super off-peak / off-peak / peak", () => {
    const t = normalize(fixture("pge-ev2.json"));
    expect(t.warnings).toEqual([]);
    const names = Object.fromEntries(t.periods.map((p) => [p.index, p.name]));
    expect(names).toEqual({ 0: "super off-peak", 1: "off-peak", 2: "peak", 3: "super off-peak", 4: "off-peak", 5: "peak" });
    expect(describeDay(t, OCT_WEEKDAY)).toBe("Peak 4–9 PM today; cheapest midnight–3 PM.");
  });

  it("SCE TOU-D-4-9PM: adj is added; winter super off-peak is midday; equal prices share a name", () => {
    const t = normalize(fixture("sce-tou-d-4-9pm.json"));
    expect(t.periods[0]!.centsPerKwh).toBe(28.166);
    expect(priceAt(t, "2026-01-14T11:00:00-08:00").periodName).toBe("super off-peak");
    // Summer weekend 4–9 PM uses a different period index with the same price as weekday peak.
    expect(priceAt(t, "2026-07-18T17:00:00-07:00")).toMatchObject({ periodName: "peak", centsPerKwh: 33.207 });
    expect(describeDay(t, "2026-01-14")).toBe("Peak 4–9 PM today; cheapest 8 AM–4 PM.");
    expect(summarize(t, "2026-01-14T12:00:00-08:00")).toBe("Time-of-use, 26.4–33.2¢/kWh; peak 4–9 PM weekdays.");
  });

  it("treats a rate without schedules as flat", () => {
    const t = normalize({ label: "x", utility: "U", name: "Flat", energyratestructure: [[{ rate: 0.3 }]] });
    expect(t.isTou).toBe(false);
    expect(t.warnings[0]).toMatch(/flat/);
    expect(describeDay(t, OCT_WEEKDAY)).toBe("Flat 30¢ per kWh today.");
  });

  it("matches the bundled demo-tou.json fixture", () => {
    const json = JSON.parse(readFileSync(new URL("../../../fixtures/tariffs/demo-tou.json", import.meta.url), "utf8"));
    expect(json).toEqual(demoTou());
  });
});

describe("fetchRatePlans", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const tou = fixture("pge-e-tou-c-region-x.json");
  const flat: OpenEIRate = { label: "flat1", utility: "PG&E", name: "E-1", startdate: 1774594800, energyratestructure: [[{ rate: 0.4 }]] };
  const expired: OpenEIRate = { ...tou, label: "old", name: "E-TOU-B", enddate: 1500000000 };
  const olderVersion: OpenEIRate = { ...tou, label: "older", startdate: 1600000000 };

  it("builds the request, drops expired and superseded rates, and ranks TOU first", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ items: [flat, expired, olderVersion, tou] }) };
    };
    const plans = await fetchRatePlans("94110", "KEY", fetchImpl, { now });
    expect(plans.map((p) => p.rateId)).toEqual([tou.label, "flat1"]);
    const u = new URL(urls[0]!);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      version: "latest",
      format: "json",
      api_key: "KEY",
      sector: "Residential",
      detail: "full",
      approved: "true",
      address: "94110",
      limit: "50",
    });
  });

  it("surfaces API errors", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "API key invalid" } }) });
    await expect(fetchRatePlans("94110", "bad", fetchImpl)).rejects.toThrow("API key invalid");
    await expect(fetchRatePlans("abc", "k", fetchImpl)).rejects.toThrow(/ZIP/);
  });
});

describe("per-month period naming", () => {
  it("splits a period that is peak in one season and mid-peak in another", () => {
    // Period 1 (40¢) is the priciest in winter but only the middle level in summer (period 2 is 60¢).
    const winter = Array.from({ length: 24 }, (_, h) => (h >= 16 && h < 21 ? 1 : 0));
    const summer = Array.from({ length: 24 }, (_, h) => (h >= 16 && h < 21 ? 2 : h >= 21 ? 1 : 0));
    const sched = Array.from({ length: 12 }, (_, m) => (m >= 5 && m <= 8 ? summer : winter));
    const t = normalize({
      label: "split",
      utility: "U",
      name: "Seasonal TOU",
      energyratestructure: [[{ rate: 0.3 }], [{ rate: 0.4 }], [{ rate: 0.6 }]],
      energyweekdayschedule: sched,
      energyweekendschedule: sched,
    });
    expect(describeDay(t, "2026-01-14")).toBe("Peak 4–9 PM today; cheapest midnight–4 PM and 9 PM–midnight.");
    expect(describeDay(t, "2026-07-15")).toBe("Peak 4–9 PM today; cheapest midnight–4 PM.");
    expect(priceAt(t, "2026-07-15T22:00:00-07:00")).toMatchObject({ centsPerKwh: 40, periodName: "off-peak" });
    expect(priceAt(t, "2026-01-14T17:00:00-08:00")).toMatchObject({ centsPerKwh: 40, periodName: "peak" });
  });
});
