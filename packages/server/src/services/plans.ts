import {
  dollars,
  getDevice,
  isSchedulable,
  iso,
  ms,
  OffPeakError,
  parseWhen,
  plan as makePlan,
  requireDevice,
  type Household,
  type NormalizedTariff,
  type Plan,
  type TaskRequest,
} from "@off-peak/core";
import { logError } from "../log.ts";
import type { Job } from "../ports.ts";
import type { Runtime } from "../runtime.ts";
import { changeDevice, note } from "./devices.ts";
import { runPresenceJob } from "./presence.ts";

export interface TaskInput {
  device: string;
  finishBy?: string;
  earliestStart?: string;
  targetPercent?: number;
  after?: string;
}

function whenOrThrow(value: string, now: Date, tz: string): string {
  const t = parseWhen(value, now, tz);
  if (t === null)
    throw new OffPeakError(
      "invalid_input",
      `I didn't understand the time "${value}".`,
      { value },
    );
  return iso(t, tz);
}

export function resolveTasks(
  h: Household,
  inputs: TaskInput[],
  now: Date,
): TaskRequest[] {
  if (!inputs.length)
    throw new OffPeakError("invalid_input", "Which appliances should I plan?");
  return inputs.map((t) => {
    const d = requireDevice(h, t.device, isSchedulable, "appliance");
    return {
      deviceId: d.id,
      ...(t.finishBy
        ? { finishBy: whenOrThrow(t.finishBy, now, h.timezone) }
        : {}),
      ...(t.earliestStart
        ? { earliestStart: whenOrThrow(t.earliestStart, now, h.timezone) }
        : {}),
      ...(t.targetPercent !== undefined
        ? { targetPercent: t.targetPercent }
        : {}),
      ...(t.after
        ? { after: requireDevice(h, t.after, isSchedulable, "appliance").id }
        : {}),
    };
  });
}

export async function proposePlan(
  rt: Runtime,
  h: Household,
  tariff: NormalizedTariff,
  tasks: TaskRequest[],
  relaxRuleIds: string[] = [],
): Promise<Plan> {
  const now = rt.clock.now();
  const p = makePlan(h, tariff, now, tasks, h.rules, {
    id: rt.newId("plan"),
    relaxRuleIds,
  });
  await rt.store.savePlan(p);
  await rt.store.setMeta("plan.approval", {
    id: p.id,
    rules: JSON.stringify(h.rules),
    tariff: JSON.stringify(tariff),
  });
  return p;
}

async function latestPlan(
  rt: Runtime,
  status: Plan["status"],
): Promise<Plan | null> {
  const plans = (await rt.store.listPlans()).filter((p) => p.status === status);
  return plans.at(-1) ?? null;
}

export async function findPlan(
  rt: Runtime,
  planId: string | undefined,
  status: Plan["status"],
): Promise<Plan> {
  const p = planId
    ? await rt.store.getPlan(planId)
    : await latestPlan(rt, status);
  if (!p) {
    throw new OffPeakError(
      "not_found",
      status === "proposed"
        ? "There's no plan to apply yet. Tell me what you'd like to run."
        : "There's no active plan to cancel.",
    );
  }
  return p;
}

/** Schedule every step of a proposed plan (idempotent), superseding older pending steps for the same devices. */
export async function applyPlan(
  rt: Runtime,
  h: Household,
  plan: Plan,
): Promise<{ plan: Plan; jobs: Job[] }> {
  const jobs = await rt.store.listJobs();
  if (plan.status === "applied")
    return { plan, jobs: jobs.filter((j) => j.planId === plan.id) };
  if (plan.status === "cancelled")
    throw new OffPeakError(
      "conflict",
      "That plan was cancelled. Ask me for a new one.",
    );
  if (plan.steps.length === 0)
    throw new OffPeakError("conflict", "That plan has nothing to schedule.");
  if (plan.conflicts.length || plan.ruleChecks.some((c) => !c.ok)) {
    throw new OffPeakError(
      "conflict",
      "That plan has unresolved conflicts. Choose an alternative and ask for a fresh plan before applying it.",
    );
  }

  const context = await rt.store.getMeta<{
    id: string;
    rules: string;
    tariff: string;
  }>("plan.approval");
  if (
    !context ||
    context.id !== plan.id ||
    context.rules !== JSON.stringify(h.rules) ||
    context.tariff !== JSON.stringify(await rt.currentTariff(h))
  ) {
    throw new OffPeakError(
      "conflict",
      "The proposal, household rules, or electricity tariff changed. Ask for a fresh plan before applying it.",
    );
  }
  // A short tolerance lets a real-clock client confirm without rejecting normal network latency.
  if (
    rt.clock.now().getTime() - Math.min(...plan.steps.map((s) => ms(s.start))) >
    60_000
  ) {
    throw new OffPeakError(
      "conflict",
      "The clock has moved beyond this proposal. Ask for a fresh plan before applying it.",
    );
  }

  const now = rt.clock.now();
  const devices = new Set(plan.steps.map((s) => s.deviceId));
  for (const j of jobs) {
    if (
      j.status === "pending" &&
      j.kind === "step_start" &&
      j.deviceId &&
      devices.has(j.deviceId) &&
      j.planId !== plan.id
    ) {
      await cancelJobPair(rt, h, j, jobs, "Replaced by a newer plan.");
    }
  }

  const created: Job[] = [];
  for (const s of plan.steps) {
    for (const [kind, at] of [
      ["step_start", s.start],
      ["step_end", s.end],
    ] as const) {
      const job: Job = {
        id: rt.newId("job"),
        at,
        kind,
        status: "pending",
        planId: plan.id,
        stepId: s.id,
        deviceId: s.deviceId,
        groupId: plan.id,
        createdAt: iso(now.getTime(), h.timezone),
      };
      await rt.store.saveJob(job);
      await rt.scheduler.schedule(job);
      created.push(job);
    }
  }
  plan.status = "applied";
  await rt.store.savePlan(plan);
  await note(rt, h, {
    source: "plan",
    action: "plan applied",
    reason: `Scheduled ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}, about ${dollars(plan.savingsCents)} cheaper than running everything at once`,
    groupId: plan.id,
    meta: { planId: plan.id, kind: "plan" },
  });
  await runDueJobs(rt, h, now);
  return { plan, jobs: created };
}

async function cancelJobPair(
  rt: Runtime,
  h: Household,
  start: Job,
  jobs: Job[],
  why: string,
): Promise<boolean> {
  const end = jobs.find(
    (j) => j.kind === "step_end" && j.stepId === start.stepId,
  );
  let changed = false;
  if (start.status === "pending") {
    start.status = "cancelled";
    start.note = why;
    await rt.store.saveJob(start);
    await rt.scheduler.cancel(start);
    changed = true;
  }
  if (end?.status === "pending") {
    if (start.status === "done") {
      // Running now: stop it.
      const d = getDevice(h, end.deviceId!);
      await changeDevice(
        rt,
        h,
        d,
        { running: false, on: false },
        { source: "user", action: "stop", reason: why, groupId: start.groupId },
      );
    }
    end.status = "cancelled";
    end.note = why;
    await rt.store.saveJob(end);
    await rt.scheduler.cancel(end);
    changed = true;
  }
  return changed;
}

export async function cancelPlan(
  rt: Runtime,
  h: Household,
  opts: { planId?: string; stepId?: string },
): Promise<{ cancelled: string[]; plan: Plan | null }> {
  const jobs = await rt.store.listJobs();
  let starts = jobs.filter(
    (j) => j.kind === "step_start" && j.status !== "cancelled",
  );
  let plan: Plan | null = null;
  if (opts.stepId) {
    starts = starts.filter((j) => j.stepId === opts.stepId);
    if (!starts.length)
      throw new OffPeakError(
        "not_found",
        "I couldn't find that scheduled step.",
      );
    plan = await rt.store.getPlan(starts[0]!.planId!);
  } else {
    plan = opts.planId ? await rt.store.getPlan(opts.planId) : null;
    if (!plan) {
      const withPending = new Set(
        jobs.filter((j) => j.status === "pending").map((j) => j.planId),
      );
      plan =
        (await rt.store.listPlans())
          .filter((p) => p.status === "applied" && withPending.has(p.id))
          .at(-1) ?? null;
    }
    if (!plan)
      throw new OffPeakError(
        "not_found",
        "There's nothing scheduled to cancel.",
      );
    starts = starts.filter((j) => j.planId === plan!.id);
  }
  const cancelled: string[] = [];
  for (const s of starts)
    if (await cancelJobPair(rt, h, s, jobs, "Cancelled by request."))
      cancelled.push(s.stepId!);
  if (plan && !opts.stepId) {
    plan.status = "cancelled";
    await rt.store.savePlan(plan);
  }
  return { cancelled, plan };
}

const KIND_ORDER: Record<Job["kind"], number> = {
  step_end: 0,
  precondition: 1,
  restore: 2,
  step_start: 3,
};

/** Run every pending job whose time has come, in time order, each "as of" its own scheduled time. */
export async function runDueJobs(
  rt: Runtime,
  h: Household,
  now: Date,
): Promise<number> {
  const due = (await rt.store.listJobs())
    .filter((j) => j.status === "pending" && ms(j.at) <= now.getTime())
    .sort(
      (a, b) => ms(a.at) - ms(b.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
    );
  for (const job of due) {
    try {
      await executeJob(rt, h, job);
    } catch (err) {
      logError(`job.${job.kind}`, err);
      job.status = "skipped";
      job.note = err instanceof Error ? err.message : String(err);
    }
    job.ranAt = iso(now.getTime(), h.timezone);
    await rt.store.saveJob(job);
  }
  if (due.length) await rt.store.saveHousehold(h);
  return due.length;
}

/** Execute one job against the household (shared by the local scheduler and the EventBridge executor Lambda). */
export async function executeJob(
  rt: Runtime,
  h: Household,
  job: Job,
): Promise<void> {
  if (job.kind === "precondition" || job.kind === "restore") {
    await runPresenceJob(rt, h, job);
    job.status = "done";
    return;
  }
  const plan = job.planId ? await rt.store.getPlan(job.planId) : null;
  const step = plan?.steps.find((s) => s.id === job.stepId);
  if (!plan || !step) {
    job.status = "skipped";
    job.note = "Plan step no longer exists.";
    return;
  }
  const device = getDevice(h, step.deviceId);
  const at = new Date(ms(job.at));
  const hours = (ms(step.end) - ms(step.start)) / 3_600_000;
  const kw = hours > 0 ? step.kwh / hours : 0;

  if (job.kind === "step_start") {
    if (h.mode === "sleep" && device.noisy) {
      job.status = "skipped";
      job.note = "Held: sleep mode keeps noisy appliances off.";
      await note(rt, h, {
        at,
        deviceId: device.id,
        source: "plan",
        action: "held",
        reason: "sleep mode keeps noisy appliances off",
        meta: { planId: plan.id, stepId: step.id },
      });
      return;
    }
    const deviceSteps = plan.steps.filter((s) => s.deviceId === device.id);
    const totalKwh = deviceSteps.reduce((a, s) => a + s.kwh, 0) || 1;
    const share = Math.round(
      Math.max(0, plan.taskSavings?.[device.id] ?? 0) * (step.kwh / totalKwh),
    );
    await changeDevice(
      rt,
      h,
      device,
      { on: true, running: true, powerW: Math.round(kw * 1000) },
      {
        at,
        source: "plan",
        action: step.action === "charge" ? "charge" : "run",
        reason: step.reason,
        estSavedCents: share,
        groupId: plan.id,
        meta: {
          planId: plan.id,
          stepId: step.id,
          step: {
            start: step.start,
            end: step.end,
            kwh: step.kwh,
            costCents: step.costCents,
          },
        },
      },
    );
    if (device.battery) {
      const startSoc = device.battery.socPercent;
      await rt.store.setMeta(`sim.charge.${device.id}`, {
        startMs: ms(step.start),
        endMs: ms(step.end),
        startSoc,
        endSoc: Math.min(
          100,
          startSoc + (step.kwh / device.battery.capacityKwh) * 100,
        ),
      });
    }
    job.status = "done";
    return;
  }

  // step_end
  if (!device.state.running) {
    job.status = "done";
    return;
  }
  if (device.battery) {
    const charge = await rt.store.getMeta<{ endSoc: number }>(
      `sim.charge.${device.id}`,
    );
    if (charge) device.battery.socPercent = Math.round(charge.endSoc * 10) / 10;
    await rt.store.setMeta(`sim.charge.${device.id}`, undefined);
  }
  await changeDevice(rt, h, device, { running: false, on: false }, null);
  const isLast =
    plan.steps.filter((s) => s.deviceId === device.id).at(-1)?.id === step.id;
  if (device.battery && isLast) {
    await note(rt, h, {
      at,
      deviceId: device.id,
      source: "plan",
      action: "charged",
      reason: `${device.name} reached ${Math.round(device.battery.socPercent)}%.`,
      groupId: plan.id,
      meta: { planId: plan.id, stepId: step.id },
    });
  }
  job.status = "done";
}
