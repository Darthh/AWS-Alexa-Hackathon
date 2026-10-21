import { z } from "zod";
import { speakTime, the } from "./format.ts";
import { isSchedulable } from "./household.ts";
import { resolveDevice } from "./resolve.ts";
import { nextOccurrence, toHHmm } from "./time.ts";
import type { HHmm, Household, Rule, Weekday } from "./types.ts";

const hhmm = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/);
const weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

/** Zod schema for a rule without its id (used to validate LLM-parsed rules). */
export const RuleBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("deadline"), deviceId: z.string(), by: hhmm, targetPercent: z.number().int().min(1).max(100).optional(), days: z.array(weekday).optional() }),
  z.object({ type: z.literal("quiet_hours"), start: hhmm, end: hhmm, appliesTo: z.literal("noisy") }),
  z.object({ type: z.literal("comfort"), zoneId: z.string().optional(), minF: z.number().min(50).max(90), maxF: z.number().min(50).max(95), when: z.enum(["occupied", "always"]) }),
  z.object({ type: z.literal("never_off"), deviceId: z.string() }),
  z.object({ type: z.literal("ask_first"), deviceId: z.string() }),
  z.object({ type: z.literal("max_load"), kw: z.number().positive().max(50) }),
]);

export type RuleBody = z.infer<typeof RuleBodySchema>;

/** "10", "10pm", "10:30 p.m.", "22:00", "7am", "midnight", "noon" → HH:mm. */
export function parseClockWord(text: string, defaultMeridiem?: "am" | "pm"): string | null {
  const t = text.trim().toLowerCase().replace(/\./g, "");
  if (t === "midnight") return "00:00";
  if (t === "noon") return "12:00";
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const mer = m[3] ?? (m[2] === undefined || hour <= 12 ? defaultMeridiem : undefined);
  if (minute > 59 || hour > 24) return null;
  if (mer) {
    if (hour < 1 || hour > 12) return null;
    if (mer === "am" && hour === 12) hour = 0;
    if (mer === "pm" && hour !== 12) hour += 12;
  }
  return toHHmm(hour % 24, minute);
}

const TIME = String.raw`(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|midnight|noon)`;
const DAYS: Record<string, Weekday[]> = {
  weekdays: ["mon", "tue", "wed", "thu", "fri"],
  "school days": ["mon", "tue", "wed", "thu", "fri"],
  "work days": ["mon", "tue", "wed", "thu", "fri"],
  workdays: ["mon", "tue", "wed", "thu", "fri"],
  weekends: ["sat", "sun"],
};

function deviceFrom(h: Household, text: string, filter?: Parameters<typeof resolveDevice>[2]): string | null {
  const r = resolveDevice(h, text, filter);
  return r.kind === "ok" ? r.item.id : null;
}

/**
 * Deterministic natural-language rule parser. Handles the common phrasings; anything else returns null
 * so a Bedrock parser can try.
 */
export function parseRuleText(text: string, h: Household): RuleBody | null {
  const t = text.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");

  // Quiet hours: "nothing loud after 10", "no noisy appliances between 10 pm and 7 am", "quiet hours 9:30pm to 6am"
  if (/\b(loud|noisy|noise|quiet)\b/.test(t)) {
    const range = new RegExp(`(?:between|from)? ?${TIME} ?(?:to|and|until|-|–) ?${TIME}`).exec(t);
    const after = new RegExp(`(?:after|past|from) ${TIME}`).exec(t);
    const before = new RegExp(`(?:before|until|till) ${TIME}`).exec(t);
    const start = range ? parseClockWord(range[1]!, "pm") : after ? parseClockWord(after[1]!, "pm") : null;
    const end = range ? parseClockWord(range[2]!, "am") : before ? parseClockWord(before[1]!, "am") : "07:00";
    if (start && end) return { type: "quiet_hours", start, end, appliesTo: "noisy" };
  }

  // Run-by limits for one appliance: "never run the dryer after 9pm", "don't start the dishwasher after 11",
  // "no laundry past 9:30 pm" → a finish deadline for that appliance.
  const notAfter = new RegExp(`^(?:never|don't|do not|no) (?:ever )?(?:run|running|start|starting|use|using)? ?(?:the )?(.+?) (?:after|past|later than) ${TIME}`).exec(t);
  // Not "don't start the dryer until after 10" (the opposite meaning), and not the car, whose rule is a
  // charge-by deadline with a target and days that this phrasing would overwrite.
  if (notAfter && !/\b(loud|noisy|noise|until|till|before)\b/.test(notAfter[1]!)) {
    const id = deviceFrom(h, notAfter[1]!, (d) => isSchedulable(d) && !d.battery);
    const at = parseClockWord(notAfter[2]!, "pm");
    if (id && at) return { type: "deadline", deviceId: id, by: at as HHmm };
  }

  // Never off: "never turn off the fish tank", "always keep the router on", "don't ever turn off the freezer"
  const never = /(?:never (?:turn|switch|shut) off|always keep|don't ever (?:turn|switch|shut) off|do not ever (?:turn|switch|shut) off|leave) (?:the )?(.+?)(?: on| alone)?$/.exec(t);
  if (never) {
    const id = deviceFrom(h, never[1]!);
    if (id) return { type: "never_off", deviceId: id };
  }

  // Ask first: "ask me before turning off the TV", "check with me before you touch the printer"
  const ask = /(?:ask(?: me)?|check with me) (?:first )?before (?:you )?(?:turning off|turn off|switching off|touching|touch|changing) (?:the )?(.+)$/.exec(t);
  if (ask) {
    const id = deviceFrom(h, ask[1]!);
    if (id) return { type: "ask_first", deviceId: id };
  }

  // Max load: "don't go over 8 kw", "max load 9.6 kilowatts", "keep the house under 7 kW"
  const load = /(?:over|under|max(?:imum)?(?: load)?(?: of)?|limit(?: of)?|above|exceed) (\d+(?:\.\d+)?) ?(?:kw|kilowatts?)\b/.exec(t);
  if (load) return { type: "max_load", kw: Number(load[1]) };

  // Comfort: "keep it between 68 and 78", "keep the office between 70 and 76 degrees when someone's there"
  const comfort = /between (\d{2}) (?:and|to) (\d{2})/.exec(t);
  if (comfort && /(keep|temperature|degrees|comfort|warm|cool)/.test(t)) {
    const minF = Number(comfort[1]);
    const maxF = Number(comfort[2]);
    const zone = h.zones.find((z) => [z.name, ...z.aliases].some((n) => t.includes(n.toLowerCase())) && !z.shared);
    const when = /(always|all the time|even when)/.test(t) ? "always" : "occupied";
    return { type: "comfort", ...(zone ? { zoneId: zone.id } : {}), minF: Math.min(minF, maxF), maxF: Math.max(minF, maxF), when };
  }

  // Deadline: "car charged by 7", "car at 80% by 6:30 am on weekdays", "make sure the dishwasher is done by 6"
  const by = new RegExp(`by ${TIME}`).exec(t);
  if (by) {
    const pct = /(\d{1,3}) ?(?:%|percent)/.exec(t);
    const daysKey = Object.keys(DAYS).find((k) => t.includes(k));
    const dayless = t.replace(by[0], " ").replace(/(\d{1,3}) ?(?:%|percent)/, " ");
    const id = deviceFrom(h, dayless.replace(/\b(make sure|charged|charge|done|finished|ready|at|on|every|is|has to be|needs to be|should be|weekdays|weekends)\b/g, " "), isSchedulable);
    const at = parseClockWord(by[1]!, "am");
    if (id && at) {
      return {
        type: "deadline",
        deviceId: id,
        by: at as HHmm,
        ...(pct ? { targetPercent: Math.min(100, Number(pct[1])) } : h.devices.find((d) => d.id === id)?.battery ? { targetPercent: 80 } : {}),
        ...(daysKey ? { days: DAYS[daysKey] } : {}),
      };
    }
  }
  return null;
}

function clockOf(hhmm: string, h: Household): string {
  return speakTime(nextOccurrence(hhmm, "2026-01-05T00:00:00Z", h.timezone), h.timezone);
}

function daysPhrase(days?: Weekday[]): string {
  if (!days?.length || days.length === 7) return "";
  if (days.length === 5 && !days.includes("sat") && !days.includes("sun")) return " on weekdays";
  if (days.length === 2 && days.includes("sat") && days.includes("sun")) return " on weekends";
  return ` on ${days.join(", ")}`;
}

/** Short summary for lists: "quiet hours 10 PM–7 AM", "the car at 80% by 7 AM on weekdays". */
export function ruleSummary(rule: RuleBody | Rule, h: Household): string {
  const name = (id: string) => the(h.devices.find((d) => d.id === id)?.name ?? "device");
  const car = (id: string) => (h.devices.find((d) => d.id === id)?.battery ? "the car" : name(id));
  switch (rule.type) {
    case "quiet_hours":
      return `quiet hours ${clockOf(rule.start, h)}–${clockOf(rule.end, h)}`;
    case "deadline":
      return `${car(rule.deviceId)}${rule.targetPercent !== undefined ? ` at ${rule.targetPercent}%` : " done"} by ${clockOf(rule.by, h)}${daysPhrase(rule.days)}`;
    case "comfort": {
      const where = rule.zoneId ? ` in the ${h.zones.find((z) => z.id === rule.zoneId)?.name.toLowerCase() ?? "room"}` : "";
      return `${rule.minF}–${rule.maxF}°F${where}${rule.when === "occupied" ? " when someone's home" : ""}`;
    }
    case "never_off":
      return `never turn off ${name(rule.deviceId)}`;
    case "ask_first":
      return `ask before turning off ${name(rule.deviceId)}`;
    case "max_load":
      return `stay under ${rule.kw} kW`;
  }
}

/** Speakable confirmation, e.g. "Got it: nothing noisy will run between 10 PM and 7 AM." */
export function confirmRule(rule: RuleBody | Rule, h: Household): string {
  const name = (id: string) => the(h.devices.find((d) => d.id === id)?.name ?? "device");
  switch (rule.type) {
    case "quiet_hours":
      return `Got it: nothing noisy will run between ${clockOf(rule.start, h)} and ${clockOf(rule.end, h)}.`;
    case "deadline": {
      const d = h.devices.find((x) => x.id === rule.deviceId);
      const who = d?.battery ? "the car" : name(rule.deviceId);
      const what = rule.targetPercent !== undefined && d?.battery ? `will be at ${rule.targetPercent}%` : "will be done";
      return `Got it: ${who} ${what} by ${clockOf(rule.by, h)}${daysPhrase(rule.days)}.`;
    }
    case "comfort":
      return `Got it: I'll keep it between ${rule.minF} and ${rule.maxF} degrees${rule.zoneId ? ` in the ${h.zones.find((z) => z.id === rule.zoneId)?.name.toLowerCase() ?? "room"}` : ""}${rule.when === "occupied" ? " when someone's home" : ""}.`;
    case "never_off":
      return `Got it: I'll never turn off ${name(rule.deviceId)}.`;
    case "ask_first":
      return `Got it: I'll ask you before turning off ${name(rule.deviceId)}.`;
    case "max_load":
      return `Got it: I'll keep the house under ${rule.kw} kilowatts.`;
  }
}

