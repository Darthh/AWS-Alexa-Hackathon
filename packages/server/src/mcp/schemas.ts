import { z } from "zod";

export const timelineSchema = z.object({
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  now: z.string(),
  rateName: z.string(),
  isDemoRate: z.boolean(),
  prices: z.array(z.object({ start: z.string(), end: z.string(), centsPerKwh: z.number(), periodName: z.string() })),
  quiet: z.array(z.object({ start: z.string(), end: z.string() })),
  rows: z.array(
    z.object({
      deviceId: z.string(),
      name: z.string(),
      deadline: z.string().optional(),
      steps: z.array(
        z.object({ start: z.string(), end: z.string(), action: z.string(), kwh: z.number(), costCents: z.number(), status: z.string() }),
      ),
    }),
  ),
});

export const stepSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  action: z.enum(["run", "charge", "set", "on", "off"]),
  start: z.string(),
  end: z.string(),
  kwh: z.number(),
  costCents: z.number(),
  reason: z.string(),
});

export const conflictSchema = z.object({
  deviceId: z.string(),
  message: z.string(),
  options: z.array(
    z.object({
      label: z.string(),
      extraCostCents: z.number().optional(),
      change: z.object({
        relaxRuleId: z.string().optional(),
        finishBy: z.string().optional(),
        earliestStart: z.string().optional(),
        targetPercent: z.number().optional(),
      }),
    }),
  ),
});

export const deviceStateSchema = z.object({
  on: z.boolean().optional(),
  running: z.boolean().optional(),
  powerW: z.number().optional(),
  setpointF: z.number().optional(),
  ecoMode: z.boolean().optional(),
});

export const ledgerEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  deviceId: z.string().optional(),
  action: z.string(),
  reason: z.string(),
  source: z.string(),
  estSavedCents: z.number(),
  estimate: z.boolean(),
  undone: z.boolean().optional(),
});

export const deviceRef = z.string().min(1).describe("Device name, alias, or room + device, e.g. 'the car', 'living room TV', 'fish tank'");
export const timeRef = z
  .string()
  .describe("24-hour 'HH:mm' (e.g. '07:00', '21:30'), 'tonight' (= done before 7 AM), 'in 2 hours', or ISO-8601");
