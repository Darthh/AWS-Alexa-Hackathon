import {
  getDevice,
  idleCandidates,
  iso,
  joinAnd,
  ms,
  OffPeakError,
  parseWhen,
  planArrival,
  planModeChange,
  planRestore,
  requireZone,
  speakTime,
  type Household,
  type LedgerSource,
  type Mode,
  type NormalizedTariff,
} from "@off-peak/core";
import type { Job } from "../ports.ts";
import type { Runtime } from "../runtime.ts";
import { changeDevice, note } from "./devices.ts";

export const DEFAULT_OCCUPANCY: Record<string, boolean> = { kitchen: true, living_room: true, office: true };

/** Simulated "people here" flags per zone (the real world; not part of the household model). */
export async function getOccupancy(rt: Runtime): Promise<Record<string, boolean>> {
  return (await rt.store.getMeta<Record<string, boolean>>("sim.occupancy")) ?? { ...DEFAULT_OCCUPANCY };
}

export async function setOccupancy(rt: Runtime, zoneId: string, present: boolean): Promise<void> {
  const occ = await getOccupancy(rt);
  occ[zoneId] = present;
  await rt.store.setMeta("sim.occupancy", occ);
}

export interface SetModeInput {
  mode: Mode;
  activeZones?: string[];
  returnAt?: string;
  confirm?: boolean;
}

export interface SetModeResult {
  mode: Mode;
  activeZones: string[];
  actions: { deviceId: string; name: string; action: string; reason: string }[];
  keptOn: { deviceId: string; name: string; reason: string }[];
  needsConfirmation: { deviceId: string; name: string }[];
  restored: { deviceId: string; name: string }[];
  arrival: { restoreAt: string; preconditionAt: string; note: string } | null;
  undoToken: string;
}

const MODE_SOURCE: Record<Exclude<Mode, "home">, LedgerSource> = { away: "away", zone: "zone", sleep: "sleep" };

/** Restore what automation turned off (only those devices), as one undoable group. */
export async function restoreHome(rt: Runtime, h: Household, source: LedgerSource, groupId: string, at?: Date): Promise<{ deviceId: string; name: string }[]> {
  const ledger = await rt.store.listLedger();
  const restores = planRestore(h, ledger);
  const restored: { deviceId: string; name: string }[] = [];
  for (const r of restores) {
    const d = getDevice(h, r.deviceId);
    let entryId: string | undefined;
    if (Object.keys(r.change).length) {
      const entry = await changeDevice(rt, h, d, r.change, {
        at,
        source,
        action: "restore",
        reason: source === "arrival" ? "you came home, so it's back the way you left it" : "you're home, so it's back the way it was",
        groupId,
      });
      entryId = entry?.id;
      restored.push({ deviceId: d.id, name: d.name });
    }
    for (const id of r.entryIds) {
      const e = ledger.find((x) => x.id === id)!;
      e.restoredBy = entryId ?? groupId;
      await rt.store.updateLedger(e);
    }
  }
  return restored;
}

async function cancelArrivalJobs(rt: Runtime): Promise<void> {
  for (const j of await rt.store.listJobs()) {
    if (j.status === "pending" && (j.kind === "precondition" || j.kind === "restore")) {
      j.status = "cancelled";
      j.note = "Superseded.";
      await rt.store.saveJob(j);
      await rt.scheduler.cancel(j);
    }
  }
}

/** Schedule pre-cooling and restore for an expected arrival time. */
export async function scheduleArrival(
  rt: Runtime,
  h: Household,
  tariff: NormalizedTariff,
  eta: number,
  groupId: string,
): Promise<{ restoreAt: string; preconditionAt: string; note: string }> {
  const now = rt.clock.now().getTime();
  const tz = h.timezone;
  const plan = planArrival(h, tariff, now, eta);
  await cancelArrivalJobs(rt);
  const ledger = await rt.store.listLedger();
  const thermostat = h.devices.find((d) => d.kind === "thermostat");
  const setback = ledger.filter((e) => e.deviceId === thermostat?.id && e.before?.setpointF !== undefined && !e.undone && !e.restoredBy)[0];
  const created = iso(now, tz);
  const jobs: Job[] = [];
  if (thermostat) {
    jobs.push({
      id: rt.newId("job"),
      at: iso(plan.preconditionAt, tz),
      kind: "precondition",
      status: "pending",
      deviceId: thermostat.id,
      groupId,
      createdAt: created,
      payload: { setpointF: setback?.before?.setpointF ?? thermostat.state.setpointF ?? 74, reason: plan.reason },
    });
  }
  jobs.push({ id: rt.newId("job"), at: iso(plan.restoreAt, tz), kind: "restore", status: "pending", groupId, createdAt: created });
  for (const j of jobs) {
    await rt.store.saveJob(j);
    await rt.scheduler.schedule(j);
  }
  return { restoreAt: iso(plan.restoreAt, tz), preconditionAt: iso(plan.preconditionAt, tz), note: plan.note };
}

export async function setMode(rt: Runtime, h: Household, tariff: NormalizedTariff, input: SetModeInput): Promise<SetModeResult> {
  const now = rt.clock.now();
  const groupId = rt.newId("grp");
  const zones = (input.activeZones ?? []).map((z) => requireZone(h, z).id);
  if (input.mode === "zone" && zones.length === 0) throw new OffPeakError("invalid_input", "Which rooms are you using?");

  const modeBefore = { mode: h.mode, activeZones: h.activeZones, returnAt: h.returnAt ?? null };
  const result: SetModeResult = {
    mode: input.mode,
    activeZones: zones.map((id) => h.zones.find((z) => z.id === id)!.name),
    actions: [],
    keptOn: [],
    needsConfirmation: [],
    restored: [],
    arrival: null,
    undoToken: groupId,
  };

  if (input.mode === "home") {
    await cancelArrivalJobs(rt);
    h.mode = "home";
    h.activeZones = [];
    delete h.returnAt;
    await note(rt, h, { source: "user", action: "mode:home", reason: "you're home", groupId, meta: { kind: "mode", modeBefore } });
    result.restored = await restoreHome(rt, h, "user", groupId);
    await rt.store.saveHousehold(h);
    return result;
  }

  const ask = input.mode === "zone" && h.autonomy.zoneOff === "ask" && !input.confirm;
  const mp = planModeChange(h, input.mode, { activeZones: zones, confirm: input.confirm });
  result.keptOn = mp.keptOn;
  result.needsConfirmation = ask ? mp.actions.map((a) => ({ deviceId: a.deviceId, name: a.name })) : mp.needsConfirmation;

  h.mode = input.mode;
  h.activeZones = input.mode === "zone" ? zones : [];
  let returnAt: number | null = null;
  if (input.returnAt) {
    returnAt = parseWhen(input.returnAt, now, h.timezone);
    if (returnAt === null) throw new OffPeakError("invalid_input", `I didn't understand the time "${input.returnAt}".`);
    h.returnAt = iso(returnAt, h.timezone);
  } else delete h.returnAt;

  const source = MODE_SOURCE[input.mode];
  await note(rt, h, {
    source,
    action: `mode:${input.mode}`,
    reason: input.mode === "away" ? "you left home" : input.mode === "sleep" ? "you went to bed" : `only the ${joinAnd(result.activeZones.map((z) => z.toLowerCase()))} ${zones.length > 1 ? "are" : "is"} in use`,
    groupId,
    meta: { kind: "mode", modeBefore },
  });
  if (!ask) {
    for (const a of mp.actions) {
      const d = getDevice(h, a.deviceId);
      await changeDevice(rt, h, d, a.change, { source, action: a.action, reason: a.reason, groupId, estimate: a.action !== "off" });
      result.actions.push({ deviceId: a.deviceId, name: a.name, action: a.action, reason: a.reason });
    }
  }
  if (input.mode === "away" && returnAt !== null) result.arrival = await scheduleArrival(rt, h, tariff, returnAt, groupId);
  await rt.store.saveHousehold(h);
  return result;
}

/** Turn off standby devices in rooms nobody has been in for 30 minutes (autonomy "auto"). */
export async function idleSweep(rt: Runtime, h: Household, now: Date): Promise<number> {
  if (h.autonomy.idleOff !== "auto" || h.mode === "away") return 0;
  let n = 0;
  for (const d of idleCandidates(h, now.getTime())) {
    if (h.rules.some((r) => r.type === "ask_first" && r.deviceId === d.id)) continue;
    const zone = h.zones.find((z) => z.id === d.zoneId)!;
    const quietSince = zone.lastMotionAt ? ms(zone.lastMotionAt) + 30 * 60_000 : now.getTime();
    const at = new Date(Math.min(now.getTime(), Math.max(quietSince, now.getTime() - 60_000)));
    await changeDevice(rt, h, d, { on: false }, {
      at,
      source: "idle",
      action: "off",
      reason: `nobody had been in the ${zone.name.toLowerCase()} for 30 minutes and it was drawing ${d.state.powerW} W on standby`,
    });
    n++;
  }
  return n;
}

/** Scheduled arrival jobs (pre-cool, restore). */
export async function runPresenceJob(rt: Runtime, h: Household, job: Job): Promise<void> {
  const at = new Date(ms(job.at));
  if (job.kind === "precondition") {
    const d = getDevice(h, job.deviceId!);
    const setpointF = Number(job.payload?.setpointF ?? 74);
    if (d.state.setpointF !== setpointF) {
      await changeDevice(rt, h, d, { setpointF }, {
        at,
        source: "arrival",
        action: "pre-cool",
        reason: String(job.payload?.reason ?? "you were due home"),
        groupId: job.groupId,
      });
    }
    return;
  }
  if (job.kind === "restore") {
    if (h.mode === "home") return;
    const modeBefore = { mode: h.mode, activeZones: h.activeZones, returnAt: h.returnAt ?? null };
    h.mode = "home";
    h.activeZones = [];
    delete h.returnAt;
    await note(rt, h, { at, source: "arrival", action: "mode:home", reason: "you're due home", groupId: job.groupId, meta: { kind: "mode", modeBefore } });
    await restoreHome(rt, h, "arrival", job.groupId ?? rt.newId("grp"), at);
  }
}

export async function arriving(
  rt: Runtime,
  h: Household,
  tariff: NormalizedTariff,
  eta: string | number,
): Promise<{ restoreAt: string; preconditionAt: string; notes: string; willRestore: boolean }> {
  const now = rt.clock.now();
  const t = parseWhen(eta, now, h.timezone);
  if (t === null) throw new OffPeakError("invalid_input", `I didn't understand the arrival time "${eta}".`);
  const r = await scheduleArrival(rt, h, tariff, t, rt.newId("grp"));
  h.returnAt = r.restoreAt;
  await rt.store.saveHousehold(h);
  // The restore job only acts when the house is in away/zone/sleep mode; don't promise it otherwise.
  const willRestore = h.mode !== "home";
  return {
    restoreAt: r.restoreAt,
    preconditionAt: r.preconditionAt,
    notes: willRestore ? `${r.note} Everything else comes back on at ${speakTime(r.restoreAt, h.timezone)}.` : r.note,
    willRestore,
  };
}
