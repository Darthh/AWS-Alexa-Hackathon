import { dailyIntervals, deadlineRuleFor, iso, ms, nextOccurrence, rulesOf, type Household, type NormalizedTariff } from "@off-peak/core";
import { DateTime } from "luxon";
import { slots } from "tou-rates";

export interface TimelineStep {
  start: string;
  end: string;
  action: string;
  kwh: number;
  costCents: number;
  status: string;
}

export interface TimelineRow {
  deviceId: string;
  name: string;
  deadline?: string;
  steps: TimelineStep[];
}

export interface Timeline {
  timezone: string;
  from: string;
  to: string;
  now: string;
  rateName: string;
  isDemoRate: boolean;
  prices: { start: string; end: string; centsPerKwh: number; periodName: string }[];
  quiet: { start: string; end: string }[];
  rows: TimelineRow[];
}

const HOUR = 3_600_000;

/** Everything the plan timeline (MCP App or native view) needs, so it can render from structuredContent alone. */
export function buildTimeline(h: Household, tariff: NormalizedTariff, now: Date, rows: TimelineRow[]): Timeline {
  const tz = h.timezone;
  const from = DateTime.fromJSDate(now, { zone: tz }).startOf("hour").toMillis();
  for (const r of rows) {
    const rule = deadlineRuleFor(h.rules, r.deviceId);
    if (rule && !r.deadline) r.deadline = iso(nextOccurrence(rule.by, now, tz, rule.days), tz);
  }
  const lastEnd = Math.max(0, ...rows.flatMap((r) => [...r.steps.map((s) => ms(s.end)), r.deadline ? ms(r.deadline) : 0]));
  const to = Math.min(from + 48 * HOUR, Math.max(from + 24 * HOUR, Math.ceil(lastEnd / HOUR) * HOUR));
  const quiet = rulesOf(h.rules, "quiet_hours")
    .flatMap((r) => dailyIntervals(r.start, r.end, from, to, tz))
    .map(([a, b]) => ({ start: iso(Math.max(a, from), tz), end: iso(Math.min(b, to), tz) }));
  return {
    timezone: tz,
    from: iso(from, tz),
    to: iso(to, tz),
    now: iso(now.getTime(), tz),
    rateName: tariff.name,
    isDemoRate: tariff.source === "demo",
    prices: slots(tariff, from, to, 60),
    quiet,
    rows: rows.slice(0, 5),
  };
}
