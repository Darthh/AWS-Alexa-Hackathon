import { OffPeakError } from "./errors.ts";
import type { Device, DeviceId, Household, Rule, Zone, ZoneId } from "./types.ts";

/** Estimated always-on household load used for the max-load check (fridge, router, etc.). */
export const BASE_LOAD_KW = 0.5;

export type RuleOf<T extends Rule["type"]> = Extract<Rule, { type: T }>;

export function rulesOf<T extends Rule["type"]>(rules: Rule[], type: T): RuleOf<T>[] {
  return rules.filter((r): r is RuleOf<T> => r.type === type);
}

export function getDevice(h: Household, id: DeviceId): Device {
  const d = h.devices.find((x) => x.id === id);
  if (!d) throw new OffPeakError("not_found", "I couldn't find that device.", { deviceId: id });
  return d;
}

export function getZone(h: Household, id: ZoneId): Zone | undefined {
  return h.zones.find((z) => z.id === id);
}

export function isNeverOff(h: Household, d: Device): boolean {
  return Boolean(d.neverOff) || rulesOf(h.rules, "never_off").some((r) => r.deviceId === d.id);
}

export function isAskFirst(h: Household, d: Device): boolean {
  return rulesOf(h.rules, "ask_first").some((r) => r.deviceId === d.id);
}

export function maxLoadRule(rules: Rule[]): RuleOf<"max_load"> | undefined {
  return rulesOf(rules, "max_load").sort((a, b) => a.kw - b.kw)[0];
}

export function deadlineRuleFor(rules: Rule[], deviceId: DeviceId): RuleOf<"deadline"> | undefined {
  return rulesOf(rules, "deadline").find((r) => r.deviceId === deviceId);
}

export function isSchedulable(d: Device): boolean {
  return Boolean(d.cycle || d.battery);
}

/** Never-off reason for speech, e.g. "never off" / "keeps food cold". */
export function keptOnReason(d: Device): string {
  if (d.tags?.includes("food")) return "keeps food cold";
  if (d.tags?.includes("network")) return "keeps the internet up";
  if (d.tags?.includes("medical")) return "medical device";
  if (d.tags?.includes("security")) return "security";
  return "never off";
}

/** Zones whose standby loads may be switched off in the given mode. */
export function inactiveZones(h: Household): ZoneId[] {
  if (h.mode === "away") return h.zones.map((z) => z.id);
  if (h.mode === "zone") return h.zones.filter((z) => !z.shared && !h.activeZones.includes(z.id)).map((z) => z.id);
  return [];
}
