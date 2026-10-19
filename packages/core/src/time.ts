import { DateTime } from "luxon";
import { toDateTime, type Instant } from "tou-rates";
import type { HHmm, Weekday } from "./types.ts";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const SLOT_MIN = 15;
export const SLOT_MS = SLOT_MIN * MINUTE;

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function ms(instant: Instant): number {
  return toDateTime(instant, "UTC").toMillis();
}

export function iso(msValue: number, timezone: string): string {
  return DateTime.fromMillis(msValue, { zone: timezone }).toISO({ suppressMilliseconds: true })!;
}

export function alignUp(msValue: number, step = SLOT_MS): number {
  return Math.ceil(msValue / step) * step;
}

export function weekdayOf(instant: Instant, timezone: string): Weekday {
  return WEEKDAYS[toDateTime(instant, timezone).weekday - 1]!;
}

export function parseHHmm(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new RangeError(`Expected HH:mm, got "${value}"`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) throw new RangeError(`Invalid time "${value}"`);
  return { hour, minute };
}

export function toHHmm(hour: number, minute = 0): HHmm {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` as HHmm;
}

/** The first local `hh:mm` strictly after `after` (optionally only on `days`), as epoch ms. */
export function nextOccurrence(hhmm: string, after: Instant, timezone: string, days?: Weekday[]): number {
  const { hour, minute } = parseHHmm(hhmm);
  const base = toDateTime(after, timezone);
  for (let d = 0; d < 8; d++) {
    const day = base.startOf("day").plus({ days: d });
    const candidate = hour === 24 ? day.plus({ days: 1 }) : day.set({ hour, minute });
    if (candidate.toMillis() <= base.toMillis()) continue;
    if (days?.length && !days.includes(WEEKDAYS[candidate.weekday - 1]!)) continue;
    return candidate.toMillis();
  }
  throw new RangeError(`No occurrence of ${hhmm} on ${days?.join(",")}`);
}

/** Daily local windows (e.g. quiet hours 22:00–07:00) that overlap [from, to), as epoch-ms pairs. */
export function dailyIntervals(start: string, end: string, from: number, to: number, timezone: string): [number, number][] {
  const s = parseHHmm(start);
  const e = parseHHmm(end);
  const crossesMidnight = e.hour * 60 + e.minute <= s.hour * 60 + s.minute;
  const out: [number, number][] = [];
  let day = DateTime.fromMillis(from, { zone: timezone }).startOf("day").minus({ days: 1 });
  const last = DateTime.fromMillis(to, { zone: timezone }).startOf("day").plus({ days: 1 });
  while (day <= last) {
    const a = day.set({ hour: s.hour, minute: s.minute }).toMillis();
    const endDay = crossesMidnight ? day.plus({ days: 1 }) : day;
    const b = (e.hour === 24 ? endDay.plus({ days: 1 }).startOf("day") : endDay.set({ hour: e.hour, minute: e.minute })).toMillis();
    if (b > from && a < to) out.push([a, b]);
    day = day.plus({ days: 1 });
  }
  return out;
}

export function overlaps(a0: number, a1: number, intervals: [number, number][]): boolean {
  return intervals.some(([b0, b1]) => a0 < b1 && b0 < a1);
}

/**
 * Parse a spoken or structured time into epoch ms (always in the future relative to `now`):
 * ISO-8601, "07:00", "7", "7am", "7:30 pm", "noon", "midnight", "tonight" (= 7 AM next morning),
 * "tomorrow morning", "in 2 hours", "in 45 minutes", or a bare number of minutes.
 */
export function parseWhen(input: string | number, now: Instant, timezone: string): number | null {
  const base = toDateTime(now, timezone);
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? base.plus({ minutes: input }).toMillis() : null;
  const text = input.trim().toLowerCase().replace(/\./g, "");
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}t/.test(text)) {
    const dt = DateTime.fromISO(input.trim(), { zone: timezone });
    return dt.isValid ? dt.toMillis() : null;
  }
  if (/^\d+$/.test(text) && Number(text) > 24) return base.plus({ minutes: Number(text) }).toMillis();

  const rel = /^in (\d+(?:\.\d+)?) ?(minutes?|mins?|hours?|hrs?|h|m)$/.exec(text);
  if (rel) {
    const n = Number(rel[1]);
    return base.plus(rel[2]!.startsWith("h") ? { minutes: n * 60 } : { minutes: n }).toMillis();
  }

  if (text === "tonight" || text === "overnight" || text === "by morning" || text === "tomorrow morning" || text === "morning") {
    return nextOccurrence("07:00", base, timezone);
  }
  if (text === "noon") return nextOccurrence("12:00", base, timezone);
  if (text === "midnight") return nextOccurrence("00:00", base, timezone);

  const clock = /^(?:by |at |until )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!clock) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  const meridiem = clock[3];
  if (hour > 24 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    return nextOccurrence(toHHmm(hour, minute), base, timezone);
  }
  if (clock[2] !== undefined || hour === 0 || hour > 12) return nextOccurrence(toHHmm(hour % 24, minute), base, timezone);
  // Bare "7" or "9": whichever of AM/PM comes next.
  const am = nextOccurrence(toHHmm(hour % 12, minute), base, timezone);
  const pm = nextOccurrence(toHHmm((hour % 12) + 12, minute), base, timezone);
  return Math.min(am, pm);
}
