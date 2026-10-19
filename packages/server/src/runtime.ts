import type { NormalizedTariff } from "@off-peak/core";
import { demoTou } from "tou-rates";
import { type Clock, defaultSimStart, RealClock, SimClock } from "./clock.ts";
import type { Config } from "./config.ts";

export interface Runtime {
  config: Config;
  clock: Clock;
  timezone: string;
  currentTariff(): Promise<NormalizedTariff>;
  close(): Promise<void>;
}

export interface RuntimeOverrides {
  clock?: Clock;
}

export async function createRuntime(config: Config, overrides: RuntimeOverrides = {}): Promise<Runtime> {
  const timezone = config.householdTz;
  const clock =
    overrides.clock ??
    (config.clock === "real" ? new RealClock() : new SimClock(config.simStart ? new Date(config.simStart) : defaultSimStart(timezone)));
  const tariff = demoTou(timezone);
  return {
    config,
    clock,
    timezone,
    currentTariff: async () => tariff,
    async close() {
      clock.stop();
      await clock.settle();
    },
  };
}
