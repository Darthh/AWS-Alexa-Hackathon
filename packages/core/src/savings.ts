import { DateTime } from "luxon";
import { priceAt, type NormalizedTariff } from "tou-rates";
import { HOUR, ms, SLOT_MS } from "./time.ts";
import type { Cents, Household, LedgerEntry } from "./types.ts";

/**
 * Assumptions for estimated (not measured) savings — see DECISIONS.md.
 * Cooling setback: 0.05 kWh per °F per hour (≈3% of a 3.5 kW AC's runtime per degree).
 * Water heater eco mode: 0.1 kWh per hour of avoided standby reheating.
 */
export const AC_KWH_PER_DEGREE_HOUR = 0.05;
export const WATER_HEATER_ECO_KWH_PER_HOUR = 0.1;

export type SavingsPeriod = "today" | "week" | "month";

export interface SavingsWin {
  entryId: string;
  deviceId?: string;
  label: string;
  cents: Cents;
  estimate: boolean;
}

export interface SavingsSummary {
  period: SavingsPeriod;
  from: string;
  to: string;
  totalCents: Cents;
  bySource: { shift: Cents; idle: Cents; away: Cents };
  estimatedCents: Cents;
  includeEstimates: boolean;
  topWins: SavingsWin[];
  /** Live value per ledger entry (shift entries use their recorded share). */
  byEntry: Record<string, Cents>;
}

export function periodStart(period: SavingsPeriod, now: number, timezone: string): number {
  const local = DateTime.fromMillis(now, { zone: timezone });
  return (period === "today" ? local.startOf("day") : period === "week" ? local.startOf("week") : local.startOf("month")).toMillis();
}

/** Energy cost of drawing `kw` over [a, b), priced per 15-minute chunk. */
function costOver(tariff: NormalizedTariff, kw: number, a: number, b: number): number {
  let cents = 0;
  for (let t = a; t < b; ) {
    const next = Math.min(b, Math.floor(t / SLOT_MS) * SLOT_MS + SLOT_MS);
    cents += priceAt(tariff, t).centsPerKwh * kw * ((next - t) / HOUR);
    t = next;
  }
  return cents;
}

const OFF_SOURCES = new Set(["away", "zone", "sleep", "idle"]);

/** When the effect of an automation entry ended: the next entry that changed the same field back, or now. */
function effectEnd(entry: LedgerEntry, later: LedgerEntry[], now: number, field: "on" | "setpointF" | "ecoMode"): number {
  for (const e of later) {
    if (e.deviceId !== entry.deviceId || ms(e.at) < ms(entry.at) || e.id === entry.id) continue;
    if (e.after && field in e.after && e.after[field] !== entry.after?.[field]) return ms(e.at);
  }
  return now;
}

/**
 * Savings from the ledger. Shift savings come from executed plan steps (baseline − plan, attributed per step);
 * idle/away savings integrate the power that would have been drawn, priced by slot, until the device came back on.
 * Thermostat setback and water-heater eco are estimates and excluded unless `includeEstimates`.
 */
export function computeSavings(
  h: Household,
  tariff: NormalizedTariff,
  ledger: LedgerEntry[],
  now: number,
  period: SavingsPeriod,
  includeEstimates = false,
): SavingsSummary {
  const from = periodStart(period, now, h.timezone);
  const bySource = { shift: 0, idle: 0, away: 0 };
  let estimated = 0;
  const wins: SavingsWin[] = [];
  const byEntry: Record<string, Cents> = {};
  const name = (id?: string) => h.devices.find((d) => d.id === id)?.name ?? "Something";

  for (const e of ledger) {
    const at = ms(e.at);
    if (e.source === "plan" && (e.action === "run" || e.action === "charge") && e.estSavedCents > 0) {
      byEntry[e.id] = e.estSavedCents;
      if (at < from || at > now) continue;
      bySource.shift += e.estSavedCents;
      const d = h.devices.find((x) => x.id === e.deviceId);
      wins.push({ entryId: e.id, deviceId: e.deviceId, label: d?.battery ? "Charging the car off-peak" : `Running ${name(e.deviceId).toLowerCase()} off-peak`, cents: e.estSavedCents, estimate: false });
      continue;
    }
    if (!OFF_SOURCES.has(e.source) || !e.deviceId || !e.after) continue;

    let cents = 0;
    let estimate = false;
    let label = "";
    if (e.after.on === false && (e.before?.powerW ?? 0) > 0) {
      const end = effectEnd(e, ledger, now, "on");
      const a = Math.max(at, from);
      const b = Math.min(end, now);
      cents = b > a ? costOver(tariff, (e.before!.powerW ?? 0) / 1000, a, b) : 0;
      byEntry[e.id] = Math.round(b > at ? costOver(tariff, (e.before!.powerW ?? 0) / 1000, at, Math.min(end, now)) : 0);
      label = `${name(e.deviceId)} off ${e.source === "idle" ? "while idle" : "while nobody was using it"}`;
    } else if (e.after.setpointF !== undefined && e.before?.setpointF !== undefined) {
      const end = effectEnd(e, ledger, now, "setpointF");
      const degrees = Math.max(0, e.after.setpointF - e.before.setpointF);
      const a = Math.max(at, from);
      const b = Math.min(end, now);
      cents = b > a ? costOver(tariff, degrees * AC_KWH_PER_DEGREE_HOUR, a, b) : 0;
      estimate = true;
      label = "Cooling set back while away (estimated)";
    } else if (e.after.ecoMode === true) {
      const end = effectEnd(e, ledger, now, "ecoMode");
      const a = Math.max(at, from);
      const b = Math.min(end, now);
      cents = b > a ? costOver(tariff, WATER_HEATER_ECO_KWH_PER_HOUR, a, b) : 0;
      estimate = true;
      label = "Water heater eco mode (estimated)";
    } else continue;

    if (estimate) {
      byEntry[e.id] = Math.round(cents);
      estimated += cents;
      if (!includeEstimates) continue;
    }
    if (e.source === "idle") bySource.idle += cents;
    else bySource.away += cents;
    if (cents > 0) wins.push({ entryId: e.id, deviceId: e.deviceId, label, cents, estimate });
  }

  const round = (x: number) => Math.round(x);
  const merged = new Map<string, SavingsWin>();
  for (const w of wins) {
    const key = w.label;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, cents: prev.cents + w.cents } : { ...w });
  }
  const shift = round(bySource.shift);
  const idle = round(bySource.idle);
  const away = round(bySource.away);
  return {
    period,
    from: DateTime.fromMillis(from, { zone: h.timezone }).toISO({ suppressMilliseconds: true })!,
    to: DateTime.fromMillis(now, { zone: h.timezone }).toISO({ suppressMilliseconds: true })!,
    totalCents: shift + idle + away,
    bySource: { shift, idle, away },
    estimatedCents: round(estimated),
    includeEstimates,
    topWins: [...merged.values()].map((w) => ({ ...w, cents: round(w.cents) })).filter((w) => w.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 3),
    byEntry,
  };
}
