import { centsPerKwhSpoken, speakTime } from "@off-peak/core";
import { nextChange, priceAt } from "tou-rates";
import { z } from "zod";
import { defineTool } from "../defineTool.ts";

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
