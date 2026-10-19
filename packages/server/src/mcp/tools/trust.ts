import { the, type LedgerEntry } from "@off-peak/core";
import { z } from "zod";
import { explain, savings, savingsSentence, undo } from "../../services/trust.ts";
import { defineTool } from "../defineTool.ts";
import { ledgerEntrySchema } from "../schemas.ts";

function entryView(e: LedgerEntry | null) {
  if (!e) return null;
  return {
    id: e.id,
    at: e.at,
    ...(e.deviceId ? { deviceId: e.deviceId } : {}),
    action: e.action,
    reason: e.reason,
    source: e.source,
    estSavedCents: e.estSavedCents,
    estimate: e.estimate,
    ...(e.undone ? { undone: true } : {}),
  };
}

export const explainTool = defineTool({
  name: "explain",
  title: "Explain an action",
  description:
    "Explain in plain words why Off-Peak did something (or will): why a device turned off, why an appliance is scheduled when it is. " +
    "Use for: 'why did the TV turn off?', 'why is the dishwasher running at midnight?', 'what did you just do?'",
  input: {
    device: z.string().optional(),
    actionId: z.string().optional().describe("Ledger entry id"),
    stepId: z.string().optional().describe("Plan step id"),
  },
  output: {
    because: z.string(),
    entry: ledgerEntrySchema.nullable(),
    step: z.object({ start: z.string(), end: z.string(), reason: z.string() }).nullable(),
    undoable: z.boolean(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, rt) {
    const h = await rt.household();
    const r = await explain(rt, h, args);
    const undoable = Boolean(r.entry && !r.entry.undone && r.entry.before && r.entry.source !== "undo");
    return {
      text: `${r.because}${undoable ? " Say undo to reverse it." : ""}`,
      data: { because: r.because, entry: entryView(r.entry), step: r.step ? { start: r.step.start, end: r.step.end, reason: r.step.reason } : null, undoable },
    };
  },
});

export const undoTool = defineTool({
  name: "undo",
  title: "Undo",
  description:
    "Reverse an Off-Peak action and restore the exact previous state: by default the most recent action (a whole mode change counts as one), or a specific one by id from explain or the ledger. " +
    "Use for: 'undo that', 'turn it back on' (right after explain), 'put everything back'.",
  input: { actionId: z.string().optional().describe("Ledger entry id or undo token; default: the latest action") },
  output: { restored: z.array(z.object({ deviceId: z.string(), name: z.string() })), undid: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(args, rt) {
    const r = await rt.withLock(async () => undo(rt, await rt.household(), args.actionId));
    rt.changed("undo");
    let text: string;
    if (r.restored.length === 1 && !/mode|schedule/.test(r.undid)) text = `Done, ${the(r.restored[0]!.name)} is back the way it was.`;
    else if (r.restored.length) text = `Done, I undid ${r.undid} and restored ${r.restored.length} ${r.restored.length === 1 ? "device" : "devices"}.`;
    else text = `Done, I undid ${r.undid}.`;
    return { text, data: r };
  },
});

export const getSavingsTool = defineTool({
  name: "get_savings",
  title: "Savings so far",
  description:
    "Report how much Off-Peak saved in dollars (today, this week, or this month), split into shifting appliances to cheaper hours, switching off idle standby power, and powering down empty rooms. Estimates (thermostat, water heater) are excluded unless includeEstimates. " +
    "Use for: 'how much did Off-Peak save me today?', 'what did I save this week?'",
  input: {
    period: z.enum(["today", "week", "month"]).default("today"),
    includeEstimates: z.boolean().optional(),
  },
  output: {
    view: z.literal("savings"),
    period: z.enum(["today", "week", "month"]),
    from: z.string(),
    to: z.string(),
    totalCents: z.number(),
    bySource: z.object({ shift: z.number(), idle: z.number(), away: z.number() }),
    estimatedCents: z.number(),
    includeEstimates: z.boolean(),
    topWins: z.array(z.object({ label: z.string(), cents: z.number(), estimate: z.boolean() })),
    isDemoRate: z.boolean(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  ui: true,
  async run(args, rt) {
    const h = await rt.household();
    const tariff = await rt.currentTariff(h);
    const period = args.period ?? "today";
    const s = await savings(rt, h, tariff, period, Boolean(args.includeEstimates));
    const isDemoRate = tariff.source === "demo";
    return {
      text: savingsSentence(s, period, isDemoRate),
      data: {
        view: "savings" as const,
        period,
        from: s.from,
        to: s.to,
        totalCents: s.totalCents,
        bySource: s.bySource,
        estimatedCents: s.estimatedCents,
        includeEstimates: s.includeEstimates,
        topWins: s.topWins.map((w) => ({ label: w.label, cents: w.cents, estimate: w.estimate })),
        isDemoRate,
      },
    };
  },
});

