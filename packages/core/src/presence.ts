import { priceAt, type NormalizedTariff } from "tou-rates";
import { speakTime } from "./format.ts";
import { isAskFirst, isNeverOff, keptOnReason, rulesOf } from "./household.ts";
import { MINUTE, ms, SLOT_MS } from "./time.ts";
import type { Device, DeviceId, DeviceState, Household, LedgerEntry, LedgerSource, Mode, ZoneId } from "./types.ts";

/** A zone counts as occupied if it saw motion in the last 20 minutes. */
export const OCCUPIED_WINDOW_MIN = 20;
/** Standby devices in a zone with no motion for 30 minutes are idle-off candidates. */
export const IDLE_AFTER_MIN = 30;
/** Pre-cool this long before an expected arrival. */
export const PRECONDITION_MIN = 30;

const SWITCHABLE = new Set<Device["kind"]>(["light", "tv", "console", "speaker", "pc", "printer", "plug", "fan"]);
const APPLIANCES = new Set<Device["kind"]>(["ev_charger", "washer", "dryer", "dishwasher"]);

export function minutesSinceMotion(h: Household, zoneId: ZoneId, now: number): number {
  const z = h.zones.find((x) => x.id === zoneId);
  if (!z?.lastMotionAt) return Infinity;
  return (now - ms(z.lastMotionAt)) / MINUTE;
}

/** Occupied by motion, or declared active by the current mode. */
export function zoneOccupied(h: Household, zoneId: ZoneId, now: number): boolean {
  const z = h.zones.find((x) => x.id === zoneId);
  if (!z) return false;
  if (h.mode === "away") return false;
  if (h.mode === "zone" && (z.shared || h.activeZones.includes(zoneId))) return true;
  return minutesSinceMotion(h, zoneId, now) < OCCUPIED_WINDOW_MIN;
}

/** True when a device is on but only drawing standby power. */
export function isOnStandby(d: Device): boolean {
  return d.standbyW !== undefined && d.state.on && !d.state.running && d.state.powerW <= d.standbyW + 2;
}

/**
 * Standby devices in zones with no motion for ≥ 30 minutes (never-off devices excluded).
 * Anything switched on in the last 30 minutes (by a person or a restore) is left alone.
 */
export function idleCandidates(h: Household, now: number): Device[] {
  return h.devices.filter((d) => {
    if (!isOnStandby(d) || isNeverOff(h, d)) return false;
    if (d.state.lastActiveAt && (now - ms(d.state.lastActiveAt)) / MINUTE < IDLE_AFTER_MIN) return false;
    const z = h.zones.find((x) => x.id === d.zoneId);
    if (!z || z.shared) return false;
    if (h.mode === "zone" && h.activeZones.includes(z.id)) return false;
    return minutesSinceMotion(h, z.id, now) >= IDLE_AFTER_MIN;
  });
}

export interface DeviceAction {
  deviceId: DeviceId;
  name: string;
  change: Partial<DeviceState>;
  action: "off" | "setback" | "eco";
  /** A "because" clause: "you left home and it was drawing 15 W on standby". */
  reason: string;
}

export interface KeptOn {
  deviceId: DeviceId;
  name: string;
  reason: string;
}

export interface ModePlan {
  actions: DeviceAction[];
  keptOn: KeptOn[];
  needsConfirmation: { deviceId: DeviceId; name: string }[];
}

function drawing(d: Device): string {
  const standby = isOnStandby(d);
  return `it was drawing ${d.state.powerW} W${standby ? " on standby" : ""}`;
}

/** The comfort-respecting away setpoint (never above an "always" comfort maximum). */
export function awaySetpoint(h: Household): number {
  const always = rulesOf(h.rules, "comfort").filter((r) => r.when === "always");
  return Math.min(h.awaySetpointF, ...always.map((r) => r.maxF));
}

/**
 * What a mode change would do. Never touches never-off devices, never interrupts running
 * appliances, and returns ask-first devices for confirmation instead of acting.
 */
export function planModeChange(
  h: Household,
  mode: Exclude<Mode, "home">,
  opts: { activeZones?: ZoneId[]; confirm?: boolean } = {},
): ModePlan {
  const active = new Set(opts.activeZones ?? []);
  const zoneName = (id: ZoneId) => h.zones.find((z) => z.id === id)?.name.toLowerCase() ?? id;
  const zoneShared = (id: ZoneId) => Boolean(h.zones.find((z) => z.id === id)?.shared);
  const inScope = (d: Device): boolean => {
    if (mode === "away") return true;
    if (mode === "zone") return !zoneShared(d.zoneId) && !active.has(d.zoneId);
    // sleep: lights outside the bedroom, plus TVs and consoles anywhere.
    if (d.kind === "light") return d.zoneId !== "bedroom" && !/bed/.test(zoneName(d.zoneId));
    return d.kind === "tv" || d.kind === "console";
  };
  const because =
    mode === "away" ? "you left home" : mode === "sleep" ? "you went to bed" : (d: Device) => `nobody is using the ${zoneName(d.zoneId)}`;
  const why = (d: Device) => (typeof because === "string" ? because : because(d));

  const plan: ModePlan = { actions: [], keptOn: [], needsConfirmation: [] };
  for (const d of h.devices) {
    if (!inScope(d)) continue;
    if (isNeverOff(h, d)) {
      if (d.state.on) plan.keptOn.push({ deviceId: d.id, name: d.name, reason: keptOnReason(d) });
      continue;
    }
    if (d.state.running) {
      plan.keptOn.push({ deviceId: d.id, name: d.name, reason: d.battery ? "charging" : "finishing its cycle" });
      continue;
    }
    if (APPLIANCES.has(d.kind)) continue;

    let action: DeviceAction | null = null;
    if (SWITCHABLE.has(d.kind) && d.state.on) {
      action = { deviceId: d.id, name: d.name, change: { on: false }, action: "off", reason: `${why(d)} and ${drawing(d)}` };
    } else if (d.kind === "thermostat" && mode !== "sleep") {
      const target = awaySetpoint(h);
      if (d.state.setpointF !== target) {
        action = { deviceId: d.id, name: d.name, change: { setpointF: target }, action: "setback", reason: `${why(d)}, so cooling is set back to ${target}°F` };
      }
    } else if (d.kind === "water_heater" && mode !== "sleep" && !d.state.ecoMode) {
      action = { deviceId: d.id, name: d.name, change: { ecoMode: true }, action: "eco", reason: `${why(d)}, so the water heater is in eco mode` };
    }
    if (!action) continue;
    if (isAskFirst(h, d) && !opts.confirm) {
      plan.needsConfirmation.push({ deviceId: d.id, name: d.name });
      continue;
    }
    plan.actions.push(action);
  }
  return plan;
}

const AUTOMATION_SOURCES = new Set<LedgerSource>(["away", "zone", "sleep", "idle"]);

export interface Restore {
  deviceId: DeviceId;
  change: Partial<DeviceState>;
  entryIds: string[];
}

/** Restore only what Off-Peak turned off (earliest `before` per device), skipping devices changed since. */
export function planRestore(h: Household, ledger: LedgerEntry[]): Restore[] {
  const byDevice = new Map<DeviceId, LedgerEntry[]>();
  for (const e of ledger) {
    if (!e.deviceId || !e.before || !AUTOMATION_SOURCES.has(e.source) || e.undone || e.restoredBy) continue;
    byDevice.set(e.deviceId, [...(byDevice.get(e.deviceId) ?? []), e]);
  }
  const out: Restore[] = [];
  for (const [deviceId, entries] of byDevice) {
    const d = h.devices.find((x) => x.id === deviceId);
    if (!d) continue;
    const latest = entries.at(-1)!;
    const unchanged = Object.entries(latest.after ?? {}).every(([k, v]) => (d.state as unknown as Record<string, unknown>)[k] === v);
    out.push({ deviceId, change: unchanged ? { ...entries[0]!.before } : {}, entryIds: entries.map((e) => e.id) });
  }
  return out;
}

export interface ArrivalPlan {
  restoreAt: number;
  preconditionAt: number;
  /** Speakable: "Cooling starts at 9 PM, when peak ends." */
  note: string;
  /** A "because" clause for the ledger: "you were due home at 9 PM and peak pricing ended then". */
  reason: string;
}

/**
 * Pre-cool 30 minutes before arrival, but never inside a peak period: if any of that window is peak,
 * start when peak ends, or at arrival if peak lasts past it.
 */
export function planArrival(h: Household, tariff: NormalizedTariff, now: number, eta: number): ArrivalPlan {
  const tz = h.timezone;
  const desired = Math.max(now, eta - PRECONDITION_MIN * MINUTE);
  const isPeak = (t: number) => priceAt(tariff, t).periodName === "peak";
  const home = speakTime(eta, tz);
  let firstPeak: number | undefined;
  for (let t = desired; t < eta; t = Math.floor(t / SLOT_MS) * SLOT_MS + SLOT_MS) {
    if (isPeak(t)) {
      firstPeak = t;
      break;
    }
  }
  if (firstPeak === undefined) {
    return {
      restoreAt: eta,
      preconditionAt: desired,
      note: `Cooling starts at ${speakTime(desired, tz)}, ${PRECONDITION_MIN} minutes before you're home.`,
      reason: `you were due home at ${home}`,
    };
  }
  let peakEnd = firstPeak;
  while (isPeak(peakEnd) && peakEnd < eta + 24 * 60 * MINUTE) peakEnd = Math.floor(peakEnd / SLOT_MS) * SLOT_MS + SLOT_MS;
  if (peakEnd <= eta) {
    const start = Math.max(peakEnd, desired);
    return {
      restoreAt: eta,
      preconditionAt: start,
      note: `Cooling starts at ${speakTime(start, tz)}, when peak ends.`,
      reason: `you were due home at ${home} and peak pricing ended at ${speakTime(start, tz)}`,
    };
  }
  return {
    restoreAt: eta,
    preconditionAt: eta,
    note: `Cooling starts when you get home at ${home}, since it's peak until ${speakTime(peakEnd, tz)}.`,
    reason: `you were due home at ${home}; it waited until then because it's peak until ${speakTime(peakEnd, tz)}`,
  };
}
