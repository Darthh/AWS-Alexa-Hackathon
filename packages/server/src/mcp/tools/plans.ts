import { describeApplied, describePlan, joinAnd, OffPeakError, requireDevice, spokenName, type Plan } from "@off-peak/core";
import { z } from "zod";
import type { Runtime } from "../../runtime.ts";
import { applyPlan, cancelPlan, findPlan, proposePlan, resolveTasks } from "../../services/plans.ts";
import { buildTimeline } from "../../services/timeline.ts";
import { defineTool } from "../defineTool.ts";
import { conflictSchema, stepSchema, timelineSchema, timeRef } from "../schemas.ts";

async function planView(rt: Runtime, p: Plan) {
  const h = await rt.household();
  const tariff = await rt.currentTariff(h);
  const names: Record<string, string> = {};
  for (const s of p.steps) names[s.deviceId] = h.devices.find((d) => d.id === s.deviceId)?.name ?? s.deviceId;
  for (const c of p.conflicts) names[c.deviceId] = h.devices.find((d) => d.id === c.deviceId)?.name ?? c.deviceId;
  const rows = new Map<string, { deviceId: string; name: string; steps: { start: string; end: string; action: string; kwh: number; costCents: number; status: string }[] }>();
  for (const s of p.steps) {
    const row = rows.get(s.deviceId) ?? { deviceId: s.deviceId, name: names[s.deviceId]!, steps: [] };
    row.steps.push({ start: s.start, end: s.end, action: s.action, kwh: s.kwh, costCents: s.costCents, status: p.status === "applied" ? "scheduled" : "planned" });
    rows.set(s.deviceId, row);
  }
  const isDemoRate = tariff.source === "demo";
  return {
    h,
    isDemoRate,
    data: {
      view: "plan" as const,
      id: p.id,
      createdAt: p.createdAt,
      status: p.status,
      steps: p.steps,
      costCents: p.costCents,
      baselineCostCents: p.baselineCostCents,
      savingsCents: p.savingsCents,
      ruleChecks: p.ruleChecks,
      conflicts: p.conflicts.map((c) => ({ ...c, options: c.options.map((o) => ({ ...o, change: { ...o.change } })) })),
      deviceNames: names,
      isDemoRate,
      timeline: buildTimeline(h, tariff, rt.clock.now(), [...rows.values()]),
    },
  };
}

const planOutput = {
  view: z.literal("plan"),
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(["proposed", "applied", "cancelled"]),
  steps: z.array(stepSchema),
  costCents: z.number(),
  baselineCostCents: z.number(),
  savingsCents: z.number(),
  ruleChecks: z.array(z.object({ ruleId: z.string(), ok: z.boolean(), note: z.string() })),
  conflicts: z.array(conflictSchema),
  deviceNames: z.record(z.string(), z.string()),
  isDemoRate: z.boolean(),
  timeline: timelineSchema,
};

export const planTasks = defineTool({
  name: "plan_tasks",
  title: "Plan appliances for the cheapest hours",
  description:
    "Plan when to run flexible appliances (EV charging, dishwasher, washer, dryer) at the lowest cost while honoring deadlines, quiet hours, and the household load limit. Proposes only; call apply_plan after the user agrees. " +
    "Use for: 'run the dishwasher when it's cheapest', 'charge the car by 7', 'do the laundry tonight but nothing loud after 10', 'car by 7, dishes and laundry tonight'. " +
    "For 'tonight' pass finishBy 'tonight'. The dryer automatically runs after the washer.",
  input: {
    tasks: z
      .array(
        z.object({
          device: z.string().min(1).describe("Appliance: 'car', 'dishwasher', 'washer', 'dryer'"),
          finishBy: timeRef.optional(),
          earliestStart: timeRef.optional(),
          targetPercent: z.number().int().min(1).max(100).optional().describe("EV only: charge target, default from the household rule (80%)"),
          after: z.string().optional().describe("Another appliance this one must wait for"),
        }),
      )
      .min(1)
      .max(5),
    relaxRules: z.array(z.string()).optional().describe("ruleIds to ignore, only when the user picked a conflict option that relaxes a rule"),
  },
  output: planOutput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  ui: true,
  async run(args, rt) {
    const p = await rt.withLock(async () => {
      const h = await rt.household();
      const tariff = await rt.currentTariff(h);
      const tasks = resolveTasks(h, args.tasks, rt.clock.now());
      return proposePlan(rt, h, tariff, tasks, args.relaxRules ?? []);
    });
    rt.changed("plan");
    const { h, isDemoRate, data } = await planView(rt, p);
    return { text: describePlan(p, h, rt.clock.now().getTime(), { demoRate: isDemoRate }), data };
  },
});

export const applyPlanTool = defineTool({
  name: "apply_plan",
  title: "Apply a plan",
  description:
    "Schedule a plan from plan_tasks so the appliances start at their planned times. Only after the user agrees (e.g. 'do it', 'go ahead', 'yes'). Applying the same plan twice is safe. " +
    "If planId is omitted, applies the most recent proposed plan.",
  input: { planId: z.string().optional().describe("id from plan_tasks; defaults to the latest proposed plan") },
  output: {
    planId: z.string(),
    status: z.enum(["proposed", "applied", "cancelled"]),
    scheduledSteps: z.array(z.object({ stepId: z.string(), deviceId: z.string(), name: z.string(), action: z.string(), start: z.string(), end: z.string() })),
    savingsCents: z.number(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, rt) {
    const { plan, h } = await rt.withLock(async () => {
      const h = await rt.household();
      const p = await findPlan(rt, args.planId, "proposed");
      const r = await applyPlan(rt, h, p);
      return { plan: r.plan, h: await rt.household() };
    });
    rt.changed("apply");
    const name = (id: string) => h.devices.find((d) => d.id === id)?.name ?? id;
    return {
      text: describeApplied(plan, h, rt.clock.now().getTime()),
      data: {
        planId: plan.id,
        status: plan.status,
        scheduledSteps: plan.steps.map((s) => ({ stepId: s.id, deviceId: s.deviceId, name: name(s.deviceId), action: s.action, start: s.start, end: s.end })),
        savingsCents: plan.savingsCents,
      },
    };
  },
});

export const cancelPlanTool = defineTool({
  name: "cancel_plan",
  title: "Cancel scheduled appliances",
  description:
    "Cancel a scheduled plan, one step, or everything scheduled for one appliance; a running appliance is stopped. " +
    "Use for: 'cancel the plan', 'don't run the dishwasher tonight', 'stop charging the car'.",
  input: {
    planId: z.string().optional(),
    stepId: z.string().optional(),
    device: z.string().optional().describe("Cancel only this appliance's steps"),
  },
  output: { cancelled: z.array(z.string()), devices: z.array(z.string()) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(args, rt) {
    const result = await rt.withLock(async () => {
      const h = await rt.household();
      if (args.device) {
        const d = requireDevice(h, args.device);
        const jobs = (await rt.store.listJobs()).filter((j) => j.kind === "step_start" && j.deviceId === d.id && j.status !== "cancelled");
        const cancelled: string[] = [];
        for (const j of jobs) {
          const end = (await rt.store.listJobs()).find((x) => x.kind === "step_end" && x.stepId === j.stepId);
          if (j.status === "pending" || end?.status === "pending") {
            const r = await cancelPlan(rt, h, { stepId: j.stepId });
            cancelled.push(...r.cancelled);
          }
        }
        if (!cancelled.length) throw new OffPeakError("not_found", `Nothing is scheduled for ${spokenName(h, d.id)}.`);
        await rt.store.saveHousehold(h);
        return { cancelled, h };
      }
      const r = await cancelPlan(rt, h, { planId: args.planId, stepId: args.stepId });
      await rt.store.saveHousehold(h);
      return { cancelled: r.cancelled, h };
    });
    rt.changed("cancel");
    const plans = await rt.store.listPlans();
    const deviceIds = [...new Set(result.cancelled.map((id) => plans.flatMap((p) => p.steps).find((s) => s.id === id)?.deviceId).filter(Boolean) as string[])];
    const names = deviceIds.map((id) => spokenName(result.h, id));
    return {
      text: result.cancelled.length ? `Okay, I cancelled ${joinAnd(names)}.` : "There was nothing left to cancel.",
      data: { cancelled: result.cancelled, devices: deviceIds.map((id) => result.h.devices.find((d) => d.id === id)?.name ?? id) },
    };
  },
});

