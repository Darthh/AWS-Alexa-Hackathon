import { toDateTime } from "tou-rates";
import { capitalize, dollars, joinAnd, joinOr, speakTime } from "./format.ts";
import { HOUR, MINUTE, ms } from "./time.ts";
import type { Household, Plan } from "./types.ts";

/** Short spoken names: "the washer", "the car", "the dishwasher". */
export function spokenName(h: Household, deviceId: string): string {
  const d = h.devices.find((x) => x.id === deviceId);
  if (!d) return "that appliance";
  if (d.kind === "ev_charger") return "the car";
  return `the ${d.name.toLowerCase()}`;
}

/** "now", "at 9 PM", "overnight", "tomorrow at 8 AM". */
export function whenPhrase(start: string, now: number, timezone: string): string {
  const t = ms(start);
  if (t - now <= 15 * MINUTE) return "now";
  const local = toDateTime(start, timezone);
  const nowLocal = toDateTime(now, timezone);
  const night = local.hour >= 22 || local.hour < 6;
  if (night && t - now <= 14 * HOUR) return "overnight";
  if (local.hasSame(nowLocal, "day")) return `at ${speakTime(start, timezone)}`;
  return `tomorrow at ${speakTime(start, timezone)}`;
}

/** The proposal sentence for a plan: decision first, one money figure, then a question. */
export function describePlan(plan: Plan, h: Household, now: number, opts: { demoRate: boolean }): string {
  const firstStart = new Map<string, string>();
  for (const s of plan.steps) if (!firstStart.has(s.deviceId)) firstStart.set(s.deviceId, s.start);
  const groups = new Map<string, string[]>();
  for (const [deviceId, start] of firstStart) {
    const w = whenPhrase(start, now, h.timezone);
    groups.set(w, [...(groups.get(w) ?? []), spokenName(h, deviceId)]);
  }
  const parts = [...groups].map(([when, names]) => `${joinAnd(names)} ${when}`);
  const demo = opts.demoRate ? " on the demo rate" : "";
  let first: string;
  if (parts.length === 0) first = "There's nothing to schedule right now";
  else if (plan.savingsCents > 0) first = `Here's the plan: ${joinAnd(parts)}, about ${dollars(plan.savingsCents)} cheaper than running it all now${demo}`;
  else first = `Here's the plan: ${joinAnd(parts)}, which is already the cheapest way to do it${demo}`;

  const conflict = plan.conflicts[0];
  if (conflict) {
    const opts2 = conflict.options.slice(0, 2).map((o) => { const l = o.label.replace(/ \(\+\$[\d.]+\)$/, ""); return l.charAt(0).toLowerCase() + l.slice(1); });
    const question = opts2.length ? ` Should I ${joinOr(opts2)}?` : "";
    const lead = parts.length ? `${first}, but ${conflict.message.charAt(0).toLowerCase()}${conflict.message.slice(1)}` : conflict.message;
    return `${lead}${question}`;
  }
  return parts.length ? `${first}. Should I go ahead?` : `${first}.`;
}

export function describeApplied(plan: Plan, h: Household, now: number): string {
  const ev = plan.steps.filter((s) => h.devices.find((d) => d.id === s.deviceId)?.kind === "ev_charger");
  const target = plan.tasks?.find((t) => ev[0] && t.deviceId === ev[0].deviceId)?.targetPercent;
  const running = plan.steps.filter((s) => ms(s.start) <= now + MINUTE).map((s) => spokenName(h, s.deviceId));
  const lead = running.length ? `${capitalize(joinAnd([...new Set(running)]))} ${running.length > 1 ? "are" : "is"} starting now` : "";
  const tail = ev.length && target !== undefined ? `the car will be at ${target}% by ${speakTime(ev.at(-1)!.end, h.timezone)}` : "";
  const second = [lead, tail].filter(Boolean).join(", and ");
  return `Done, it's all scheduled.${second ? ` ${capitalize(second)}.` : ""}`;
}
