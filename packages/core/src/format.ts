import { formatClock, formatRange, toDateTime, type Instant } from "tou-rates";
import type { Cents } from "./types.ts";

/** 774 → "$7.74". */
export function dollars(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
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
