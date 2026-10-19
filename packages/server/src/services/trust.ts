import {
  capitalize,
  computeSavings,
  dollars,
  getDevice,
  joinAnd,
  ms,
  OffPeakError,
  requireDevice,
  speakTime,
  the,
  type DeviceState,
  type Household,
  type LedgerEntry,
  type Mode,
  type NormalizedTariff,
  type SavingsPeriod,
} from "@off-peak/core";
import type { Runtime } from "../runtime.ts";
import { changeDevice, note } from "./devices.ts";
import { activeSteps } from "./status.ts";

const UNDOABLE = (e: LedgerEntry) => !e.undone && e.source !== "undo" && (Boolean(e.before) || e.meta?.kind === "mode" || e.meta?.kind === "plan");

/** "The TV turned off at 6:45 PM because you left home and it was drawing 15 W on standby." */
export function explainEntry(e: LedgerEntry, h: Household): string {
  const d = e.deviceId ? h.devices.find((x) => x.id === e.deviceId) : undefined;
  const who = d ? capitalize(the(d.name)) : "Off-Peak";
  const when = speakTime(e.at, h.timezone);
  const verb: Record<string, string> = {
    off: "turned off",
    on: "turned on",
    run: "started",
    charge: "started charging",
    setback: "was set back",
    eco: "went into eco mode",
    restore: "came back on",
    "pre-cool": "started cooling",
    set: "was adjusted",
    stop: "stopped",
    held: "was held",
    charged: "finished charging",
  };
  const v = verb[e.action] ?? e.action.replace(/^mode:/, "switched to ").concat(e.action.startsWith("mode:") ? " mode" : "");
  if (e.source === "plan" && (e.action === "run" || e.action === "charge")) return `${who} ${v} at ${when}: ${e.reason.charAt(0).toLowerCase()}${e.reason.slice(1)}`;
  return `${who} ${v} at ${when} because ${e.reason}.`;
}

export async function explain(
  rt: Runtime,
  h: Household,
  input: { device?: string; actionId?: string; stepId?: string },
): Promise<{ because: string; entry: LedgerEntry | null; step: { start: string; end: string; reason: string } | null }> {
  const ledger = await rt.store.listLedger();
  if (input.actionId) {
    const e = ledger.find((x) => x.id === input.actionId || x.groupId === input.actionId);
    if (!e) throw new OffPeakError("not_found", "I couldn't find that action.");
    return { because: explainEntry(e, h), entry: e, step: null };
  }
  if (input.stepId) {
    const a = (await activeSteps(rt)).find((x) => x.stepId === input.stepId);
    const plan = a?.plan ?? (await rt.store.listPlans()).find((p) => p.steps.some((s) => s.id === input.stepId));
    const step = plan?.steps.find((s) => s.id === input.stepId);
    if (!step) throw new OffPeakError("not_found", "I couldn't find that step.");
    const d = getDevice(h, step.deviceId);
    return { because: `${capitalize(the(d.name))} is scheduled for ${speakTime(step.start, h.timezone)}: ${step.reason.charAt(0).toLowerCase()}${step.reason.slice(1)}`, entry: null, step };
  }
  if (!input.device) {
    const last = ledger.filter((e) => e.deviceId && e.source !== "undo").at(-1);
    if (!last) throw new OffPeakError("not_found", "Off-Peak hasn't done anything yet today.");
    return { because: explainEntry(last, h), entry: last, step: null };
  }
  const d = requireDevice(h, input.device);
  const now = rt.clock.now().getTime();
  const upcoming = (await activeSteps(rt)).find((a) => a.status === "scheduled" && a.plan.steps.find((s) => s.id === a.stepId)?.deviceId === d.id);
  const last = ledger.filter((e) => e.deviceId === d.id).at(-1);
  if (upcoming && (!last || ms(last.at) < now - 60 * 60_000)) {
    const step = upcoming.plan.steps.find((s) => s.id === upcoming.stepId)!;
    return { because: `${capitalize(the(d.name))} is scheduled for ${speakTime(step.start, h.timezone)}: ${step.reason.charAt(0).toLowerCase()}${step.reason.slice(1)}`, entry: null, step };
  }
  if (!last) throw new OffPeakError("not_found", `Off-Peak hasn't changed ${the(d.name)} today.`);
  return { because: explainEntry(last, h), entry: last, step: null };
}

/** Undo one action, or a whole group (a mode change, a plan). Default: the most recent undoable thing. */
export async function undo(rt: Runtime, h: Household, actionId?: string): Promise<{ restored: { deviceId: string; name: string }[]; undid: string }> {
  const ledger = await rt.store.listLedger();
  let targets: LedgerEntry[];
  if (actionId) {
    const byId = ledger.find((e) => e.id === actionId);
    targets = byId ? [byId] : ledger.filter((e) => e.groupId === actionId);
    if (!targets.length) throw new OffPeakError("not_found", "I couldn't find that action to undo.");
    // Undoing the mode-change note undoes the whole group.
    if (byId?.meta?.kind === "mode" && byId.groupId) targets = ledger.filter((e) => e.groupId === byId.groupId);
  } else {
    const last = ledger.filter(UNDOABLE).at(-1);
    if (!last) throw new OffPeakError("not_found", "There's nothing to undo.");
    targets = last.groupId ? ledger.filter((e) => e.groupId === last.groupId) : [last];
  }
  targets = targets.filter(UNDOABLE);
  if (!targets.length) throw new OffPeakError("conflict", "That's already been undone.");

  const groupId = rt.newId("undo");
  const restored: { deviceId: string; name: string }[] = [];
  const modeNote = targets.find((e) => e.meta?.kind === "mode");
  let undid = modeNote ? `${modeNote.action.replace("mode:", "")} mode` : targets.some((e) => e.meta?.kind === "plan") ? "the schedule" : "";
  for (const e of [...targets].reverse()) {
    if (e.meta?.kind === "plan") {
      const planId = String(e.meta.planId);
      const { cancelPlan } = await import("./plans.ts");
      await cancelPlan(rt, h, { planId }).catch(() => undefined);
      undid ||= "the schedule";
    } else if (e.meta?.kind === "mode") {
      const before = e.meta.modeBefore as { mode: Mode; activeZones: string[]; returnAt: string | null } | undefined;
      if (before) {
        h.mode = before.mode;
        h.activeZones = before.activeZones;
        if (before.returnAt) h.returnAt = before.returnAt;
        else delete h.returnAt;
      }
      undid ||= `${e.action.replace("mode:", "")} mode`;
    } else if (e.deviceId && e.before) {
      const d = getDevice(h, e.deviceId);
      await changeDevice(rt, h, d, e.before as Partial<DeviceState>, { source: "undo", action: "undo", reason: "you asked to undo it", undoOf: e.id, groupId });
      restored.push({ deviceId: d.id, name: d.name });
      undid ||= the(d.name);
    }
    e.undone = true;
    await rt.store.updateLedger(e);
  }
  if (!restored.length && targets.some((e) => e.meta?.kind === "mode")) {
    await note(rt, h, { source: "undo", action: "undo", reason: "you asked to undo it", undoOf: targets[0]!.id, groupId });
  }
  await rt.store.saveHousehold(h);
  return { restored, undid };
}

export async function savings(rt: Runtime, h: Household, tariff: NormalizedTariff, period: SavingsPeriod, includeEstimates: boolean) {
  const ledger = await rt.store.listLedger();
  return computeSavings(h, tariff, ledger, rt.clock.now().getTime(), period, includeEstimates);
}

export function savingsSentence(s: ReturnType<typeof computeSavings>, period: SavingsPeriod, demoRate: boolean): string {
  const label = period === "today" ? "today" : period === "week" ? "this week" : "this month";
  const demo = demoRate ? " on the demo rate" : "";
  if (s.totalCents <= 0) return `No savings yet ${label}${demo}; schedule something and I'll start counting.`;
  const sources = [
    s.bySource.shift > 0 ? "running things off-peak" : "",
    s.bySource.idle > 0 ? "switching off idle standby power" : "",
    s.bySource.away > 0 ? "powering down while rooms were empty" : "",
  ].filter(Boolean);
  const est = s.includeEstimates && s.estimatedCents > 0 ? ", including estimated heating and cooling savings" : "";
  return `Off-Peak saved you about ${dollars(s.totalCents)} ${label}${demo}${est}. Most of it came from ${joinAnd(sources.slice(0, 2))}.`;
}

