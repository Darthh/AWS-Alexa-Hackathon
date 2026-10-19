import type { DateTime } from "luxon";

/** Speakable 12-hour clock: "9 PM", "9:30 PM", "midnight", "noon". */
export function formatClock(dt: DateTime): string {
  if (dt.minute === 0) {
    if (dt.hour === 0) return "midnight";
    if (dt.hour === 12) return "noon";
  }
  const h12 = dt.hour % 12 === 0 ? 12 : dt.hour % 12;
  const meridiem = dt.hour < 12 ? "AM" : "PM";
  return dt.minute === 0 ? `${h12} ${meridiem}` : `${h12}:${String(dt.minute).padStart(2, "0")} ${meridiem}`;
}

function meridiemOf(label: string): "AM" | "PM" | null {
  if (label.endsWith(" AM")) return "AM";
  if (label.endsWith(" PM")) return "PM";
  return null;
}

/** "4–9 PM", "midnight–6 AM", "6 AM–4 PM", "9 PM–midnight". */
export function formatRange(from: DateTime, to: DateTime): string {
  const a = formatClock(from);
  const b = formatClock(to);
  const ma = meridiemOf(a);
  if (ma && ma === meridiemOf(b)) return `${a.slice(0, -3)}–${b}`;
  return `${a}–${b}`;
}

/** 24 → "24", 24.35 → "24.4". */
export function formatCentsValue(cents: number): string {
  return Number.isInteger(cents) ? String(cents) : cents.toFixed(1);
}
