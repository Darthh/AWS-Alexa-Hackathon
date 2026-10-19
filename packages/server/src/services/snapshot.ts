import {
  computeSavings,
  isAskFirst,
  isNeverOff,
  isOnStandby,
  iso,
  minutesSinceMotion,
  ruleSummary,
  zoneOccupied,
} from "@off-peak/core";
import { DateTime } from "luxon";
import { describeDay, nextChange, priceAt, slots } from "tou-rates";
import type { Runtime } from "../runtime.ts";
import { getOccupancy } from "./presence.ts";
import { activeSteps } from "./status.ts";

/** Everything the web client's house panel, clock, ledger and timeline need, in one JSON document. */
export async function snapshot(rt: Runtime) {
  const h = await rt.household();
  const tariff = await rt.currentTariff(h);
  const now = rt.clock.now();
  const nowMs = now.getTime();
  const tz = h.timezone;
  const local = DateTime.fromJSDate(now, { zone: tz });
  const occupancy = await getOccupancy(rt);
  const active = await activeSteps(rt);
  const ledger = await rt.store.listLedger();
  const savings = computeSavings(h, tariff, ledger, nowMs, "today", false);
  const scheduledDevices = new Set(active.filter((a) => a.status === "scheduled").map((a) => a.job.deviceId));
  const plans = await rt.store.listPlans();
  const jobs = (await rt.store.listJobs()).filter((j) => j.status === "pending").sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const price = priceAt(tariff, now);
  const change = nextChange(tariff, now);
  const dayStart = local.startOf("day");

  return {
    clock: { ...rt.clock.state(), local: iso(nowMs, tz), label: local.toFormat("ccc h:mm a"), timezone: tz },
    household: {
      id: h.id,
      name: h.name,
      mode: h.mode,
      activeZones: h.activeZones,
      returnAt: h.returnAt ?? null,
      autonomy: h.autonomy,
      zones: h.zones.map((z) => ({
        ...z,
        present: Boolean(occupancy[z.id]),
        occupied: zoneOccupied(h, z.id, nowMs),
        idleMinutes: Number.isFinite(minutesSinceMotion(h, z.id, nowMs)) ? Math.round(minutesSinceMotion(h, z.id, nowMs)) : null,
      })),
      devices: h.devices.map((d) => ({
        ...d,
        flags: {
          neverOff: isNeverOff(h, d),
          askFirst: isAskFirst(h, d),
          scheduled: scheduledDevices.has(d.id),
          standby: isOnStandby(d),
        },
      })),
      rules: h.rules.map((r) => ({ ...r, summary: ruleSummary(r, h) })),
    },
    tariff: {
      rateId: tariff.rateId,
      name: tariff.name,
      utility: tariff.utility,
      source: tariff.source,
      isDemoRate: tariff.source === "demo",
      warnings: tariff.warnings,
      today: describeDay(tariff, now),
    },
    price: { now: price, next: change },
    strip: slots(tariff, dayStart.toMillis(), dayStart.plus({ days: 1 }).toMillis(), 60),
    steps: active.map((a) => ({ ...a.plan.steps.find((s) => s.id === a.stepId)!, status: a.status, planId: a.plan.id })),
    jobs: jobs.map((j) => ({ id: j.id, kind: j.kind, at: j.at, deviceId: j.deviceId ?? null })),
    plan: plans.at(-1) ?? null,
    ledger: ledger.slice(-200).reverse().map((e) => ({ ...e, liveSavedCents: savings.byEntry[e.id] ?? e.estSavedCents })),
    savings: { totalCents: savings.totalCents, bySource: savings.bySource, estimatedCents: savings.estimatedCents },
    powerW: h.devices.reduce((s, d) => s + (d.state.on ? d.state.powerW : 0), 0),
  };
}
