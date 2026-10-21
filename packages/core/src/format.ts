import { formatClock, formatRange, toDateTime, type Instant } from "tou-rates";
import type { Cents } from "./types.ts";

/** 774 → "$7.74". */
export function dollars(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Money as it should be spoken: 30 → "30 cents", 1 → "1 cent", 774 → "$7.74". */
export function money(cents: Cents): string {
  const c = Math.round(Math.abs(cents));
  if (c < 100) return `${c} ${c === 1 ? "cent" : "cents"}`;
  return dollars(c);
}

/**
 * Lowercase the first letter when a sentence is embedded mid-sentence, but keep the pronoun "I"
 * ("I can't fit…") and acronyms or brand-cased words ("TV", "EV", "Wi-Fi router").
 */
export function lowerFirst(s: string): string {
  if (/^I(\b|')/.test(s)) return s;
  const word = /^[^\s]+/.exec(s)?.[0] ?? "";
  if (word.length > 1 && /[A-Z]/.test(word.slice(1))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Turn display notation into words a speaker reads naturally: "24¢/kWh" → "24 cents a kilowatt-hour",
 * "9.6 kW" → "9.6 kilowatts", "15 W" → "15 watts", "68–78°F" → "68 to 78 degrees", "10 PM–7 AM" → "10 PM to 7 AM".
 */
export function speakable(text: string): string {
  const unit = (one: string, many: string) => (_m: string, n: string) => `${n} ${n === "1" ? one : many}`;
  let out = text
    .replace(/(\d+(?:\.\d+)?) ?¢\/kWh/g, unit("cent a kilowatt-hour", "cents a kilowatt-hour"))
    .replace(/(\d+(?:\.\d+)?) ?¢/g, unit("cent", "cents"))
    .replace(/(\d+(?:\.\d+)?) kWh\b/g, unit("kilowatt-hour", "kilowatt-hours"))
    .replace(/(\d+(?:\.\d+)?) kW (limit|cap)\b/g, "$1-kilowatt $2")
    .replace(/(\d+(?:\.\d+)?) kW\b/g, unit("kilowatt", "kilowatts"))
    .replace(/(\d+(?:\.\d+)?) W\b/g, unit("watt", "watts"))
    .replace(/(\d+)–(\d+) ?°F/g, "$1 to $2 degrees")
    .replace(/(\d+) ?°F/g, "$1 degrees");
  // Only numeric and clock ranges become "to" ("10 PM–7 AM", "midnight–6 AM"), never names ("Rate E-1 – Residential").
  const range = /(\d|\b[AP]M|\bmidnight|\bnoon)–((?:\$)?\d|midnight\b|noon\b)/g;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(range, "$1 to $2");
  }
  return out;
}

/** 49 → "49 cents", 24.5 → "24.5 cents". */
export function centsPerKwhSpoken(cents: number): string {
  const v = Number.isInteger(cents) ? String(cents) : cents.toFixed(1);
  return `${v} cents`;
}

/** Speakable local time: "9 PM", "4:45 AM", "midnight". */
export function speakTime(instant: Instant, timezone: string): string {
  return formatClock(toDateTime(instant, timezone));
}

export function speakRange(from: Instant, to: Instant, timezone: string): string {
  return formatRange(toDateTime(from, timezone), toDateTime(to, timezone));
}

/** "the washer" from "Washer"; keeps acronyms like "TV" and "Wi-Fi router" intact. */
export function the(name: string): string {
  // Lowercase ordinary capitalized words ("Washer" → "washer") but keep "TV", "Wi-Fi router", "PC".
  return /^[A-Z][a-z]+(\s|$)/.test(name) ? `the ${name.charAt(0).toLowerCase()}${name.slice(1)}` : `the ${name}`;
}

/** ["a"] → "a"; ["a","b"] → "a and b"; ["a","b","c"] → "a, b, and c". */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** ["a","b"] → "a or b"; ["a","b","c"] → "a, b, or c". */
export function joinOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
