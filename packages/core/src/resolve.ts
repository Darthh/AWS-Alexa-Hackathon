import { OffPeakError } from "./errors.ts";
import { capitalize, joinOr, the } from "./format.ts";
import type { Device, DeviceKind, Household, Zone } from "./types.ts";

export type Resolution<T> = { kind: "ok"; item: T } | { kind: "ambiguous"; candidates: T[] } | { kind: "none" };

const KIND_WORDS: Record<string, DeviceKind[]> = {
  light: ["light"],
  lights: ["light"],
  lamp: ["light"],
  lamps: ["light"],
  car: ["ev_charger"],
  ev: ["ev_charger"],
  charger: ["ev_charger"],
  tv: ["tv"],
  television: ["tv"],
  ac: ["thermostat"],
  thermostat: ["thermostat"],
  heater: ["water_heater"],
  speaker: ["speaker", "plug"],
  computer: ["pc"],
  fan: ["fan"],
};

export function normalizeRef(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9+ ]+/g, " ")
    .replace(/\b(the|my|our|a|an|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalizeRef(s).split(" ").filter(Boolean);
}

/** Edit distance where swapping two adjacent letters counts as one edit ("wahser" → "washer"). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** "tvs" → "tv", "lamps" → "lamp", "fans" → "fan" (not "glass" → "glas"). */
function stem(w: string): string {
  return w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

function kindWords(w: string): DeviceKind[] | undefined {
  return KIND_WORDS[w] ?? KIND_WORDS[stem(w)];
}

/**
 * Typo tolerance is for real misspellings ("dishwahser", "termostat", "frigde"), not for short words
 * that happen to be one letter apart from another device ("tv" vs "ev", "light" vs "night"):
 * references under 4 letters never fuzzy-match, and short device-kind words must match exactly.
 */
function typoMatch(a: string, b: string): boolean {
  a = stem(a);
  b = stem(b);
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if ((kindWords(a) || kindWords(b)) && Math.min(a.length, b.length) <= 5) return false;
  return editDistance(a, b) <= (Math.min(a.length, b.length) >= 8 ? 2 : 1);
}

function nameScore(ref: string, names: string[]): number {
  const r = normalizeRef(ref);
  if (!r) return 0;
  let best = 0;
  for (const raw of names) {
    const n = normalizeRef(raw);
    if (!n) continue;
    if (n === r) return 100;
    if (typoMatch(n, r)) best = Math.max(best, 85);
    const rt = new Set(tokens(r));
    const nt = tokens(n);
    const hit = nt.filter((t) => rt.has(t) || [...rt].some((x) => stem(x) === stem(t) || (x.length >= 4 && typoMatch(x, t)))).length;
    if (hit) best = Math.max(best, Math.round((70 * hit) / Math.max(nt.length, rt.size)) + (hit === nt.length ? 10 : 0));
  }
  return best;
}

function zoneMention(h: Household, ref: string): { zone: Zone; rest: string } | null {
  const r = ` ${normalizeRef(ref)} `;
  for (const z of h.zones) {
    for (const name of [z.name, z.id.replace(/_/g, " "), ...z.aliases]) {
      const n = normalizeRef(name);
      if (n && r.includes(` ${n} `)) return { zone: z, rest: r.replace(` ${n} `, " ").trim() };
    }
  }
  return null;
}

function pick<T>(scored: { item: T; score: number }[], min = 45): Resolution<T> {
  const sorted = scored.filter((s) => s.score >= min).sort((a, b) => b.score - a.score);
  if (sorted.length === 0) return { kind: "none" };
  const top = sorted[0]!;
  const close = sorted.filter((s) => s.score >= top.score - 5);
  if (close.length === 1 || top.score === 100 && close.filter((s) => s.score === 100).length === 1) {
    return { kind: "ok", item: top.item };
  }
  return { kind: "ambiguous", candidates: close.map((s) => s.item) };
}

/** Resolve "the car", "living room TV", "fish tank", "printer" to a device. */
export function resolveDevice(h: Household, ref: string, filter?: (d: Device) => boolean): Resolution<Device> {
  const devices = h.devices.filter(filter ?? (() => true));
  const zm = zoneMention(h, ref);
  const scored = devices.map((d) => {
    const names = [d.name, d.id.replace(/_/g, " "), ...d.aliases];
    let score = nameScore(ref, names);
    const kinds = tokens(zm ? zm.rest : ref).flatMap((t) => kindWords(t) ?? []);
    if (kinds.includes(d.kind)) score = Math.max(score, 60);
    if (zm) {
      if (d.zoneId === zm.zone.id) {
        const restScore = zm.rest ? Math.max(nameScore(zm.rest, names), kinds.includes(d.kind) ? 80 : 0) : 0;
        score = Math.max(score, restScore ? Math.min(99, restScore + 15) : score);
      } else {
        score = Math.min(score, 50);
      }
    }
    return { item: d, score };
  });
  return pick(scored);
}

export function resolveZone(h: Household, ref: string): Resolution<Zone> {
  return pick(h.zones.map((z) => ({ item: z, score: nameScore(ref, [z.name, z.id.replace(/_/g, " "), ...z.aliases]) })), 60);
}

/** Resolve or throw a speakable error (clarifying question when ambiguous). */
export function requireDevice(h: Household, ref: string, filter?: (d: Device) => boolean, what = "device"): Device {
  const exact = h.devices.find((d) => d.id === ref);
  if (exact && (!filter || filter(exact))) return exact;
  const r = resolveDevice(h, ref, filter);
  if (r.kind === "ok") return r.item;
  if (r.kind === "ambiguous") {
    const names = r.candidates.slice(0, 4).map((d) => the(d.name));
    throw new OffPeakError("ambiguous", `Which one did you mean: ${joinOr(names)}?`, {
      candidates: r.candidates.map((d) => ({ id: d.id, name: d.name })),
    });
  }
  if (filter) {
    // The device exists but isn't the right kind here ("schedule the TV"): say what *is* possible.
    const any = resolveDevice(h, ref);
    if (any.kind === "ok") {
      const allowed = h.devices.filter(filter).map((d) => (d.kind === "ev_charger" ? "the car" : the(d.name)));
      throw new OffPeakError(
        "invalid_input",
        `${capitalize(the(any.item.name))} isn't ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what} I can schedule. I can plan ${joinOr(allowed)}.`,
        { ref, deviceId: any.item.id },
      );
    }
  }
  throw new OffPeakError("not_found", `I couldn't find ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what} called "${ref}".`, { ref });
}

export function requireZone(h: Household, ref: string): Zone {
  const exact = h.zones.find((z) => z.id === ref);
  if (exact) return exact;
  const r = resolveZone(h, ref);
  if (r.kind === "ok") return r.item;
  if (r.kind === "ambiguous") {
    throw new OffPeakError("ambiguous", `Which room: ${joinOr(r.candidates.map((z) => z.name.toLowerCase()))}?`, {
      candidates: r.candidates.map((z) => ({ id: z.id, name: z.name })),
    });
  }
  throw new OffPeakError("not_found", `I don't know a room called "${ref}".`, { ref });
}
