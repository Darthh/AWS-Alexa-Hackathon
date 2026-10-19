import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Household } from "@off-peak/core";
import type { OpenEIRate } from "tou-rates";

/** Repo `fixtures/` directory (override with FIXTURES_DIR, e.g. inside a Lambda bundle). */
export function fixturesDir(): string {
  return process.env.FIXTURES_DIR ?? fileURLToPath(new URL("../../../fixtures/", import.meta.url));
}

export function loadSeedHousehold(opts: { timezone: string; zip?: string }): Household {
  const h = JSON.parse(readFileSync(join(fixturesDir(), "demo-home.json"), "utf8")) as Household;
  h.timezone = opts.timezone;
  if (opts.zip) h.zip = opts.zip;
  return h;
}

/** Real OpenEI responses bundled for offline use (everything except the synthetic demo rate). */
export function loadBundledRates(): OpenEIRate[] {
  const dir = join(fixturesDir(), "tariffs");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "demo-tou.json")
    .sort()
    .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { items?: OpenEIRate[] }).items ?? []);
}
