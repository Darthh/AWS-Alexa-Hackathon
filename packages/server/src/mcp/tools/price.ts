import {
  centsPerKwhSpoken,
  dollars,
  isSchedulable,
  ms,
  OffPeakError,
  parseWhen,
  plan,
  requireDevice,
  speakRange,
  speakTime,
  the,
  type Device,
  type Household,
} from "@off-peak/core";
import { nextChange, priceAt } from "tou-rates";
import { z } from "zod";
import { defineTool } from "../defineTool.ts";
import { timeRef } from "../schemas.ts";

export const getPriceNow = defineTool({
  name: "get_price_now",
  title: "Electricity price now",
  description:
    "Tell the user what electricity costs right now on their rate plan, which period it is (peak, off-peak, super off-peak) and when it changes next. " +
    "Use for: 'how much is power right now?', 'is it peak time?', 'when does peak end?', 'is now a good time to run the dryer?'",
  input: {},
  output: {
    centsPerKwh: z.number(),
    periodName: z.string(),
    until: z.string().nullable().describe("ISO time the current period ends"),
    next: z.object({ centsPerKwh: z.number(), periodName: z.string() }).nullable(),
    rateName: z.string(),
    isDemoRate: z.boolean(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(_args, rt) {
    const now = rt.clock.now();
    const tariff = await rt.currentTariff();
    const tz = rt.timezone;
    const price = priceAt(tariff, now);
    const change = nextChange(tariff, now);
    const isDemoRate = tariff.source === "demo";
    const head = `It's ${price.periodName} right now: ${centsPerKwhSpoken(price.centsPerKwh)} per kilowatt-hour${isDemoRate ? " on the demo rate" : ""}.`;
    const tail = change ? ` That lasts until ${speakTime(change.at, tz)}, then it's ${change.periodName}.` : "";
    return {
      text: head + tail,
      data: {
        centsPerKwh: price.centsPerKwh,
        periodName: price.periodName,
        until: change?.at ?? null,
        next: change ? { centsPerKwh: change.centsPerKwh, periodName: change.periodName } : null,
        rateName: tariff.name,
        isDemoRate,
      },
    };
  },
});

/** A throwaway 1 kW device so "cheapest 2 hours" can reuse the planner. */
function genericLoad(minutes: number): Device {
  return {
    id: "__window",
    name: "that",
    aliases: [],
    zoneId: "whole_home",
    kind: "plug",
    ratedKw: 1,
    flexible: true,
    cycle: { durationMin: minutes, energyKwh: minutes / 60, interruptible: false },
    state: { on: false, powerW: 0 },
  };
}

export const findCheapestWindow = defineTool({
  name: "find_cheapest_window",
  title: "Cheapest time to run something",
  description:
    "Find the cheapest time to run one appliance (or any block of minutes) before an optional deadline, honoring quiet hours, and compare it with running it right now. Read-only; it does not schedule anything. " +
    "Use for: 'when's the cheapest time to run the dishwasher?', 'when should I run the dryer before 10?', 'what are the cheapest two hours tonight?'",
  input: {
    device: z.string().optional().describe("Appliance name, e.g. 'dishwasher', 'dryer', 'the car'"),
    durationMinutes: z.number().int().min(15).max(720).optional().describe("Length of the block when no device is given (default 60)"),
    finishBy: timeRef.optional(),
  },
  output: {
    device: z.string().nullable(),
    start: z.string(),
    end: z.string(),
    costCents: z.number(),
    costIfNowCents: z.number(),
    savingsCents: z.number(),
    periodName: z.string(),
    isDemoRate: z.boolean(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, rt) {
    const h = await rt.household();
    const tariff = await rt.currentTariff(h);
    const now = rt.clock.now();
    const tz = h.timezone;
    let household: Household = h;
    let deviceId: string;
    let label: string;
    if (args.device) {
      const d = requireDevice(h, args.device, isSchedulable, "appliance");
      deviceId = d.id;
      label = d.battery ? "charge the car" : `run ${the(d.name)}`;
    } else {
      const g = genericLoad(args.durationMinutes ?? 60);
      household = { ...h, devices: [...h.devices, g] };
      deviceId = g.id;
      label = `use ${args.durationMinutes ?? 60} minutes of power`;
    }
    let finishBy: string | undefined;
    if (args.finishBy) {
      const t = parseWhen(args.finishBy, now, tz);
      if (t === null) throw new OffPeakError("invalid_input", `I didn't understand the time "${args.finishBy}".`);
      finishBy = new Date(t).toISOString();
    }
    const p = plan(household, tariff, now, [{ deviceId, ...(finishBy ? { finishBy } : {}) }]);
    if (p.conflicts.length) throw new OffPeakError("conflict", p.conflicts[0]!.message, { options: p.conflicts[0]!.options });
    if (!p.steps.length) throw new OffPeakError("conflict", p.ruleChecks.at(-1)?.note ?? "There's nothing to run.");
    const start = p.steps[0]!.start;
    const end = p.steps.at(-1)!.end;
    const isDemoRate = tariff.source === "demo";
    const startsNow = ms(start) - now.getTime() <= 15 * 60_000;
    const demo = isDemoRate ? " on the demo rate" : "";
    const text = startsNow
      ? `Now is already the cheapest time to ${label}${finishBy ? ` before ${speakTime(finishBy, tz)}` : ""}${demo}.`
      : `The cheapest time to ${label} is ${speakRange(start, end, tz)}, about ${dollars(p.savingsCents)} less than doing it now${demo}.`;
    return {
      text,
      data: {
        device: args.device ? (h.devices.find((d) => d.id === deviceId)?.name ?? null) : null,
        start,
        end,
        costCents: p.costCents,
        costIfNowCents: p.baselineCostCents,
        savingsCents: p.savingsCents,
        periodName: priceAt(tariff, start).periodName,
        isDemoRate,
      },
    };
  },
});
