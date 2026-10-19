import { DateTime } from "luxon";
import { formatCentsValue, formatRange } from "./format.ts";
import type { Instant, NormalizedTariff, PricePoint, PriceSlot } from "./types.ts";

export function toDateTime(instant: Instant, zone: string): DateTime {
  let dt: DateTime;
  if (DateTime.isDateTime(instant)) dt = instant;
  else if (instant instanceof Date) dt = DateTime.fromJSDate(instant);
  else if (typeof instant === "number") dt = DateTime.fromMillis(instant);
  else dt = DateTime.fromISO(instant, { setZone: true });
  if (!dt.isValid) throw new RangeError(`Invalid instant: ${String(instant)}`);
  return dt.setZone(zone);
}

export function toIso(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone }).toISO({ suppressMilliseconds: true })!;
}

/** Period index in effect at `instant`, read from the local wall-clock hour. */
export function periodIndexAt(tariff: NormalizedTariff, instant: Instant): number {
  const local = toDateTime(instant, tariff.timezone);
  const schedule = local.weekday >= 6 ? tariff.weekend : tariff.weekday;
  return schedule[local.month - 1]?.[local.hour] ?? 0;
}

export function priceAt(tariff: NormalizedTariff, instant: Instant): PricePoint {
  const index = periodIndexAt(tariff, instant);
  const period = tariff.periods.find((p) => p.index === index) ?? tariff.periods[0];
  if (!period) throw new Error(`Tariff ${tariff.rateId} has no periods`);
  return { centsPerKwh: period.centsPerKwh, periodIndex: period.index, periodName: period.name };
}

/**
 * Fixed-length price slots in absolute time. Each slot takes the price at its start,
 * so callers should pass a `from` aligned to `stepMin` (TOU boundaries are on the hour).
 */
export function slots(tariff: NormalizedTariff, from: Instant, to: Instant, stepMin = 15): PriceSlot[] {
  const start = toDateTime(from, tariff.timezone).toMillis();
  const end = toDateTime(to, tariff.timezone).toMillis();
  const step = stepMin * 60_000;
  const out: PriceSlot[] = [];
  for (let t = start; t < end; t += step) {
    const p = priceAt(tariff, t);
    out.push({
      start: toIso(t, tariff.timezone),
      end: toIso(Math.min(t + step, end), tariff.timezone),
      centsPerKwh: p.centsPerKwh,
      periodName: p.periodName,
    });
  }
  return out;
}

/** The next local hour boundary at which the price or period changes. */
export function nextChange(
  tariff: NormalizedTariff,
  instant: Instant,
  maxHours = 72,
): ({ at: string } & PricePoint) | null {
  const current = priceAt(tariff, instant);
  let t = toDateTime(instant, tariff.timezone).startOf("hour").plus({ hours: 1 });
  for (let i = 0; i < maxHours; i++) {
    const p = priceAt(tariff, t);
    if (p.centsPerKwh !== current.centsPerKwh || p.periodName !== current.periodName) {
      return { at: t.toISO({ suppressMilliseconds: true })!, ...p };
    }
    t = t.plus({ hours: 1 });
  }
  return null;
}

interface HourPrice {
  at: DateTime;
  centsPerKwh: number;
  periodName: string;
}

/** Every real hour of a local calendar day (23 on spring-forward, 25 on fall-back). */
export function hoursOfDay(tariff: NormalizedTariff, date: Instant): HourPrice[] {
  const day =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? DateTime.fromISO(date, { zone: tariff.timezone })
      : toDateTime(date, tariff.timezone);
  const start = day.startOf("day");
  const end = start.plus({ days: 1 });
  const out: HourPrice[] = [];
  for (let t = start; t < end; t = t.plus({ hours: 1 })) {
    const p = priceAt(tariff, t);
    out.push({ at: t, centsPerKwh: p.centsPerKwh, periodName: p.periodName });
  }
  return out;
}

function rangesWhere(hours: HourPrice[], pred: (h: HourPrice) => boolean): [DateTime, DateTime][] {
  const ranges: [DateTime, DateTime][] = [];
  let open: DateTime | null = null;
  hours.forEach((h, i) => {
    if (pred(h)) {
      open ??= h.at;
      const next = hours[i + 1];
      if (!next || !pred(next)) {
        ranges.push([open, h.at.plus({ hours: 1 })]);
        open = null;
      }
    }
  });
  return ranges;
}

function joinRanges(ranges: [DateTime, DateTime][]): string {
  return ranges.map(([a, b]) => formatRange(a, b)).join(" and ");
}

/** e.g. "Peak 4–9 PM today; cheapest midnight–6 AM." */
export function describeDay(tariff: NormalizedTariff, date: Instant, label = "today"): string {
  const hours = hoursOfDay(tariff, date);
  const prices = hours.map((h) => h.centsPerKwh);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return `Flat ${formatCentsValue(min)}¢ per kWh ${label}.`;
  const cheapest = joinRanges(rangesWhere(hours, (h) => h.centsPerKwh === min));
  const peak = rangesWhere(hours, (h) => h.periodName === "peak");
  if (peak.length === 0) return `No peak ${label}; cheapest ${cheapest}.`;
  return `Peak ${joinRanges(peak)} ${label}; cheapest ${cheapest}.`;
}

/** One-line plan summary for lists, e.g. "Time-of-use, 24–49¢/kWh; peak 4–9 PM weekdays." */
export function summarize(tariff: NormalizedTariff, reference: Instant = new Date()): string {
  const prices = tariff.periods.map((p) => p.centsPerKwh);
  const min = formatCentsValue(Math.min(...prices));
  const max = formatCentsValue(Math.max(...prices));
  if (!tariff.isTou) return min === max ? `Flat rate, ${min}¢/kWh.` : `Flat rate by season, ${min}–${max}¢/kWh.`;
  let day = toDateTime(reference, tariff.timezone);
  while (day.weekday >= 6) day = day.plus({ days: 1 });
  const peak = rangesWhere(hoursOfDay(tariff, day), (h) => h.periodName === "peak");
  const peakText = peak.length ? `; peak ${joinRanges(peak)} weekdays` : "";
  return `Time-of-use, ${min}–${max}¢/kWh${peakText}.`;
}
