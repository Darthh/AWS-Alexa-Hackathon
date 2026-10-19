import type { Household } from "@off-peak/core";
import type { OpenEIRate } from "tou-rates";
import home from "../fixtures/demo-home.json";
import pge from "../fixtures/tariffs/pge-e-tou-c-region-x.json";
import ev from "../fixtures/tariffs/pge-ev2.json";
import sce from "../fixtures/tariffs/sce-tou-d-4-9pm.json";

export function fixturesDir(): never {
  throw new Error(
    "The public demo uses bundled fixtures and simulated devices.",
  );
}

// Build-time replacement for the Node filesystem loader. The original local/AWS loader remains intact.
export function loadSeedHousehold(opts: {
  timezone: string;
  zip?: string;
}): Household {
  const h = structuredClone(home) as Household;
  h.timezone = opts.timezone;
  if (opts.zip) h.zip = opts.zip;
  return h;
}

export function loadBundledRates(): OpenEIRate[] {
  return structuredClone(
    [pge, ev, sce].flatMap((rate) => rate.items),
  ) as OpenEIRate[];
}
