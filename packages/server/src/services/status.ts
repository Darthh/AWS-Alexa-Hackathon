import { idleCandidates, ms, zoneOccupied, type Household, type NormalizedTariff, type Plan } from "@off-peak/core";
import { nextChange, priceAt } from "tou-rates";
import type { Job } from "../ports.ts";
import type { Runtime } from "../runtime.ts";
import { buildTimeline, type Timeline, type TimelineRow } from "./timeline.ts";

export interface HomeStatus {
  view: "home";
  mode: Household["mode"];
  activeZones: string[];
  returnAt: string | null;
  running: { deviceId: string; name: string; powerW: number; until: string | null }[];
  scheduled: { stepId: string; planId: string; deviceId: string; name: string; action: string; start: string; end: string }[];
  priceNow: { centsPerKwh: number; periodName: string };
  nextChange: { at: string; centsPerKwh: number; periodName: string } | null;
  idleCandidates: { deviceId: string; name: string; zone: string; standbyW: number }[];
  powerNowW: number;
  rateName: string;
  isDemoRate: boolean;
  timeline: Timeline;
}

/** Steps of applied plans that are still pending or running, joined with their jobs. */
export async function activeSteps(rt: Runtime): Promise<{ plan: Plan; stepId: string; job: Job; status: "scheduled" | "running" }[]> {
  const jobs = await rt.store.listJobs();
  const plans = new Map((await rt.store.listPlans()).map((p) => [p.id, p]));
  const out: { plan: Plan; stepId: string; job: Job; status: "scheduled" | "running" }[] = [];
  for (const start of jobs.filter((j) => j.kind === "step_start" && j.stepId && j.planId)) {
    const end = jobs.find((j) => j.kind === "step_end" && j.stepId === start.stepId);
    const plan = plans.get(start.planId!);
    if (!plan) continue;
    if (start.status === "pending") out.push({ plan, stepId: start.stepId!, job: start, status: "scheduled" });
    else if (start.status === "done" && end?.status === "pending") out.push({ plan, stepId: start.stepId!, job: start, status: "running" });
  }
  return out.sort((a, b) => ms(a.job.at) - ms(b.job.at));
}

export async function timelineRowsFromSteps(rt: Runtime, h: Household): Promise<TimelineRow[]> {
  const rows = new Map<string, TimelineRow>();
  for (const a of await activeSteps(rt)) {
    const step = a.plan.steps.find((s) => s.id === a.stepId);
    if (!step) continue;
    const name = h.devices.find((d) => d.id === step.deviceId)?.name ?? step.deviceId;
    const row = rows.get(step.deviceId) ?? { deviceId: step.deviceId, name, steps: [] };
    row.steps.push({ start: step.start, end: step.end, action: step.action, kwh: step.kwh, costCents: step.costCents, status: a.status });
    rows.set(step.deviceId, row);
  }
  return [...rows.values()];
}

export async function homeStatus(rt: Runtime, h: Household, tariff: NormalizedTariff): Promise<HomeStatus> {
  const now = rt.clock.now();
  const nowMs = now.getTime();
  const active = await activeSteps(rt);
  const price = priceAt(tariff, now);
  const change = nextChange(tariff, now);
  const zoneName = (id: string) => h.zones.find((z) => z.id === id)?.name ?? id;

  const running = h.devices
    .filter((d) => d.state.running)
    .map((d) => {
      const a = active.find((x) => x.status === "running" && x.plan.steps.find((s) => s.id === x.stepId)?.deviceId === d.id);
      const step = a?.plan.steps.find((s) => s.id === a.stepId);
      return { deviceId: d.id, name: d.name, powerW: d.state.powerW, until: step?.end ?? null };
    });

  const scheduled = active
    .filter((a) => a.status === "scheduled")
    .flatMap((a) => {
      const step = a.plan.steps.find((s) => s.id === a.stepId);
      if (!step) return [];
      const name = h.devices.find((d) => d.id === step.deviceId)?.name ?? step.deviceId;
      return [{ stepId: step.id, planId: a.plan.id, deviceId: step.deviceId, name, action: step.action, start: step.start, end: step.end }];
    });

  return {
    view: "home",
    mode: h.mode,
    activeZones: h.mode === "zone" ? h.activeZones.map(zoneName) : h.zones.filter((z) => !z.shared && zoneOccupied(h, z.id, nowMs)).map((z) => z.name),
    returnAt: h.returnAt ?? null,
    running,
    scheduled,
    priceNow: { centsPerKwh: price.centsPerKwh, periodName: price.periodName },
    nextChange: change ? { at: change.at, centsPerKwh: change.centsPerKwh, periodName: change.periodName } : null,
    idleCandidates: idleCandidates(h, nowMs).map((d) => ({ deviceId: d.id, name: d.name, zone: zoneName(d.zoneId), standbyW: d.standbyW ?? 0 })),
    powerNowW: h.devices.reduce((s, d) => s + (d.state.on ? d.state.powerW : 0), 0),
    rateName: tariff.name,
    isDemoRate: tariff.source === "demo",
    timeline: buildTimeline(h, tariff, now, await timelineRowsFromSteps(rt, h)),
  };
}
