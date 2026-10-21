import type { NormalizedTariff, OpenEIRate, TariffPeriod } from "./types.ts";

export interface NormalizeOptions {
  /** IANA zone the schedule hours are in (OpenEI schedules are local wall-clock hours). */
  timezone?: string;
  source?: "openei" | "fixture";
}

const DAYS_PER_MONTH = 365 / 12;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isSchedule(s: unknown, periodCount: number): s is number[][] {
  return (
    Array.isArray(s) &&
    s.length === 12 &&
    s.every(
      (m) =>
        Array.isArray(m) &&
        m.length === 24 &&
        m.every((i) => Number.isInteger(i) && i >= 0 && i < periodCount),
    )
  );
}

function flatSchedule(): number[][] {
  return Array.from({ length: 12 }, () => Array<number>(24).fill(0));
}

/** Name for each price level within one month (cheapest → super off-peak/off-peak, priciest → peak). */
function monthNames(cents: number[], used: Set<number>): Map<number, string> {
  const levels = [...new Set([...used].map((i) => cents[i]!))].sort((a, b) => a - b);
  const n = levels.length;
  const levelName = (level: number): string => {
    const rank = levels.indexOf(level);
    if (n === 1) return "off-peak";
    if (rank === n - 1) return "peak";
    if (rank === 0) return n >= 3 ? "super off-peak" : "off-peak";
    return rank === 1 && n >= 3 ? "off-peak" : "mid-peak";
  };
  return new Map([...used].map((i) => [i, levelName(cents[i]!)]));
}

/**
 * Name periods by relative price per month. A period index reused across seasons can rank differently
 * (peak in winter, mid-peak in summer); such periods are split into one entry per name so every month
 * reads correctly, and the schedules are remapped to the new indices.
 */
function namePeriods(
  cents: number[],
  weekday: number[][],
  weekend: number[][],
): { periods: TariffPeriod[]; weekday: number[][]; weekend: number[][] } {
  const perMonth = weekday.map((wk, m) => monthNames(cents, new Set([...wk, ...(weekend[m] ?? [])])));
  const tally = cents.map(() => new Map<string, number>());
  perMonth.forEach((names) => names.forEach((name, i) => tally[i]!.set(name, (tally[i]!.get(name) ?? 0) + 1)));

  const periods: TariffPeriod[] = cents.map((c, index) => {
    const best = [...tally[index]!].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "off-peak";
    return { index, name: best, centsPerKwh: c };
  });
  const extra = new Map<string, number>();
  const indexFor = (i: number, name: string): number => {
    if (periods[i]!.name === name) return i;
    const key = `${i}|${name}`;
    if (!extra.has(key)) {
      extra.set(key, periods.length);
      periods.push({ index: periods.length, name, centsPerKwh: cents[i]! });
    }
    return extra.get(key)!;
  };
  const remap = (schedule: number[][]) => schedule.map((hours, m) => hours.map((i) => indexFor(i, perMonth[m]!.get(i)!)));
  return { periods, weekday: remap(weekday), weekend: remap(weekend) };
}

function fixedMonthlyCents(raw: OpenEIRate): number | undefined {
  if (typeof raw.fixedmonthlycharge === "number") return Math.round(raw.fixedmonthlycharge * 100);
  const amount = raw.fixedchargefirstmeter;
  if (typeof amount !== "number") return undefined;
  const unit = (raw.fixedchargeunits ?? "$/month").toLowerCase();
  if (unit.includes("day")) return Math.round(amount * DAYS_PER_MONTH * 100);
  if (unit.includes("year")) return Math.round((amount / 12) * 100);
  return Math.round(amount * 100);
}

/** Tier-1 price (rate + adjustment) of each period, in cents/kWh. */
function tierOneCents(raw: OpenEIRate): number[] {
  return (raw.energyratestructure ?? []).map((tiers) => {
    const t = tiers[0] ?? {};
    return round3(((t.rate ?? 0) + (t.adj ?? 0)) * 100);
  });
}

/**
 * Time-of-use means the price actually changes within a day: some month's weekday schedule spans
 * more than one distinct price. (Two period indices with the same price are still a flat rate.)
 */
function hasTimeVaryingPrice(weekday: number[][], cents: number[]): boolean {
  return weekday.some((month) => new Set(month.map((i) => cents[i])).size > 1);
}

export function isExpired(raw: OpenEIRate, now: Date = new Date()): boolean {
  return typeof raw.enddate === "number" && raw.enddate * 1000 < now.getTime();
}

/** Convert one OpenEI URDB rate into a schedulable tariff (tier 1 + adjustment per period). */
export function normalize(raw: OpenEIRate, opts: NormalizeOptions = {}): NormalizedTariff {
  const structure = raw.energyratestructure ?? [];
  if (structure.length === 0) throw new Error(`Rate ${raw.label} has no energy rate structure`);
  const warnings: string[] = [];

  const cents = tierOneCents(raw);
  if (structure.some((tiers) => tiers.length > 1)) warnings.push("Tiered pricing simplified to tier 1.");

  let weekday = raw.energyweekdayschedule;
  let weekend = raw.energyweekendschedule;
  if (!isSchedule(weekday, cents.length)) {
    warnings.push("No valid time-of-use schedule; treated as a flat rate.");
    weekday = flatSchedule();
    weekend = flatSchedule();
  } else if (!isSchedule(weekend, cents.length)) {
    warnings.push("No weekend schedule; using the weekday schedule.");
    weekend = weekday;
  }

  const named = namePeriods(cents, weekday, weekend!);
  const isTou = hasTimeVaryingPrice(weekday, cents);

  return {
    rateId: raw.label,
    utility: raw.utility,
    name: raw.name,
    source: opts.source ?? "openei",
    timezone: opts.timezone ?? "America/Los_Angeles",
    periods: named.periods,
    weekday: named.weekday,
    weekend: named.weekend,
    fixedMonthlyCents: fixedMonthlyCents(raw),
    isTou,
    warnings,
  };
}

const TOU_NAME = /\bTOU\b|time[- ]of[- ]use/i;

/** TOU rates first, then names that say TOU / Time of Use, then newest. */
export function rankRates(rates: OpenEIRate[]): OpenEIRate[] {
  const score = (r: OpenEIRate) => {
    // Same TOU test as normalize(), so ranking and the isTou flag never disagree.
    const tou = isSchedule(r.energyweekdayschedule, r.energyratestructure?.length ?? 0) && hasTimeVaryingPrice(r.energyweekdayschedule!, tierOneCents(r));
    return (tou ? 2 : 0) + (TOU_NAME.test(r.name) ? 1 : 0);
  };
  return [...rates].sort((a, b) => score(b) - score(a) || (b.startdate ?? 0) - (a.startdate ?? 0) || a.name.localeCompare(b.name));
}

/** Keep only the newest version of each (utility, name). */
export function latestVersions(rates: OpenEIRate[]): OpenEIRate[] {
  const byKey = new Map<string, OpenEIRate>();
  for (const r of rates) {
    const key = `${r.utility}::${r.name}`;
    const prev = byKey.get(key);
    if (!prev || (r.startdate ?? 0) > (prev.startdate ?? 0)) byKey.set(key, r);
  }
  return [...byKey.values()];
}
