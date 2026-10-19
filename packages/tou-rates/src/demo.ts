import type { NormalizedTariff } from "./types.ts";

export const DEMO_RATE_ID = "DEMO_TOU";

const SUPER_OFF_PEAK = 0;
const OFF_PEAK = 1;
const PEAK = 2;

function weekdayHours(): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    if (h < 6) return SUPER_OFF_PEAK;
    if (h >= 16 && h < 21) return PEAK;
    return OFF_PEAK;
  });
}

function weekendHours(): number[] {
  return Array.from({ length: 24 }, (_, h) => (h < 6 ? SUPER_OFF_PEAK : OFF_PEAK));
}

/**
 * Synthetic time-of-use rate used whenever no real tariff is available.
 * Always labeled "Demo rate (synthetic)" so it is never mistaken for a real plan.
 */
export function demoTou(timezone = "America/Los_Angeles"): NormalizedTariff {
  return {
    rateId: DEMO_RATE_ID,
    utility: "Off-Peak demo",
    name: "Demo rate (synthetic)",
    source: "demo",
    timezone,
    periods: [
      { index: SUPER_OFF_PEAK, name: "super off-peak", centsPerKwh: 24 },
      { index: OFF_PEAK, name: "off-peak", centsPerKwh: 31 },
      { index: PEAK, name: "peak", centsPerKwh: 49 },
    ],
    weekday: Array.from({ length: 12 }, weekdayHours),
    weekend: Array.from({ length: 12 }, weekendHours),
    isTou: true,
    warnings: [],
  };
}

export const DEMO_TOU: NormalizedTariff = demoTou();
