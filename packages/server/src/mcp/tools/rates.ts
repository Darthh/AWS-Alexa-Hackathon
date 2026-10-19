import { normalizeRef, OffPeakError, type NormalizedTariff } from "@off-peak/core";
import { DEMO_RATE_ID, describeDay, summarize } from "tou-rates";
import { z } from "zod";
import type { Runtime } from "../../runtime.ts";
import { defineTool } from "../defineTool.ts";

function shortUtility(u: string): string {
  return u.replace(/ (Co|Company|Inc|Corp)\.?$/i, "").replace("Pacific Gas & Electric", "PG&E").replace("Southern California Edison", "SCE");
}

export const findRatePlans = defineTool({
  name: "find_rate_plans",
  title: "Find electricity rate plans",
  description:
    "Look up residential electricity rate plans (tariffs) for a US ZIP code in the OpenEI Utility Rate Database, time-of-use plans first. Follow with select_rate_plan. " +
    "Use for: 'find my rate plan, I'm in 94110', 'what electricity plans are there for my ZIP?', 'set up my utility rate'.",
  input: {
    zip: z
      .union([z.string().regex(/^\d{5}$/), z.number().int().min(0).max(99999)])
      .describe("5-digit US ZIP code (string preferred; numbers are accepted)"),
  },
  output: {
    plans: z.array(z.object({ rateId: z.string(), utility: z.string(), name: z.string(), isTou: z.boolean(), summary: z.string() })),
    source: z.enum(["openei", "bundled"]),
    note: z.string().nullable(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args, rt) {
    const now = rt.clock.now();
    const zip = String(args.zip).padStart(5, "0");
    const { plans, source, note } = await rt.tariffs.findPlans(zip);
    for (const p of plans) await rt.store.saveTariff(p);
    const list = plans.slice(0, 8).map((p) => ({ rateId: p.rateId, utility: p.utility, name: p.name, isTou: p.isTou, summary: summarize(p, now) }));
    let text: string;
    if (!list.length) text = `I couldn't find residential rate plans for ZIP ${zip}.`;
    else {
      const top = plans.find((p) => p.isTou && p.source !== "demo") ?? plans[0]!;
      const where = source === "openei" ? `for ${zip}` : "that work offline";
      text = `I found ${list.length} rate plans ${where}; the best time-of-use match is ${shortUtility(top.utility)} ${top.name}. Want me to switch to it?`;
    }
    return { text, data: { plans: list, source, note: note ?? null } };
  },
});

async function findTariff(rt: Runtime, ref: string): Promise<NormalizedTariff> {
  const direct = (await rt.store.getTariff(ref)) ?? (await rt.tariffs.get(ref));
  if (direct) return direct;
  const n = normalizeRef(ref);
  if (/\b(demo|synthetic|test)\b/.test(n)) {
    const demo = await rt.tariffs.get(DEMO_RATE_ID);
    if (demo) return demo;
  }
  const h = await rt.household();
  const { plans } = await rt.tariffs.findPlans(h.zip ?? "00000");
  const hits = plans.filter((p) => normalizeRef(`${p.utility} ${p.name}`).includes(n) || normalizeRef(p.name).includes(n));
  if (hits.length >= 1) return hits[0]!;
  throw new OffPeakError("not_found", "I couldn't find that rate plan. Ask me to look up plans for your ZIP code first.", { rateId: ref });
}

export const selectRatePlan = defineTool({
  name: "select_rate_plan",
  title: "Use a rate plan",
  description:
    "Switch the household to a rate plan (from find_rate_plans) so every price, plan, and savings figure uses it. " +
    "Use for: 'use the E-TOU-C plan', 'switch to the first one', 'go back to the demo rate'.",
  input: { rateId: z.string().min(1).describe("rateId from find_rate_plans (or the plan's name)") },
  output: {
    rateId: z.string(),
    utility: z.string(),
    name: z.string(),
    isTou: z.boolean(),
    summary: z.string(),
    warnings: z.array(z.string()),
    today: z.string(),
    isDemoRate: z.boolean(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async run(args, rt) {
    const tariff = await findTariff(rt, args.rateId);
    const now = rt.clock.now();
    await rt.withLock(async () => {
      await rt.store.saveTariff(tariff);
      const h = await rt.household();
      h.rateId = tariff.rateId;
      await rt.store.saveHousehold(h);
    });
    rt.changed("tariff");
    const today = describeDay(tariff, now);
    const isDemoRate = tariff.source === "demo";
    return {
      text: `Switched to ${isDemoRate ? "the demo rate" : `${shortUtility(tariff.utility)} ${tariff.name}`}. ${today}`,
      data: {
        rateId: tariff.rateId,
        utility: tariff.utility,
        name: tariff.name,
        isTou: tariff.isTou,
        summary: summarize(tariff, now),
        warnings: tariff.warnings,
        today,
        isDemoRate,
      },
    };
  },
});
