import type { NormalizedTariff } from "@off-peak/core";
import { DEMO_RATE_ID, demoTou, fetchRate, fetchRatePlans, normalize, rankRates } from "tou-rates";
import { loadBundledRates } from "../fixtures.ts";
import { logError } from "../log.ts";
import type { TariffSource } from "../ports.ts";

/** Offline plans: the synthetic demo rate plus the real trimmed OpenEI fixtures. */
class BundledTariffs implements TariffSource {
  readonly kind: "demo" | "fixture";
  protected readonly timezone: string;
  readonly #bundled: NormalizedTariff[];

  constructor(kind: "demo" | "fixture", timezone: string) {
    this.kind = kind;
    this.timezone = timezone;
    this.#bundled = rankRates(loadBundledRates()).map((r) => normalize(r, { timezone, source: "fixture" }));
  }

  defaultRateId(): string {
    return this.kind === "fixture" && this.#bundled[0] ? this.#bundled[0].rateId : DEMO_RATE_ID;
  }

  bundled(): NormalizedTariff[] {
    return [demoTou(this.timezone), ...this.#bundled];
  }

  async findPlans(_zip: string) {
    return {
      plans: this.bundled(),
      source: "bundled" as const,
      note: "Offline mode: showing bundled rate plans (set TARIFF_SOURCE=openei for live lookups).",
    };
  }

  async get(rateId: string): Promise<NormalizedTariff | null> {
    return this.bundled().find((t) => t.rateId === rateId) ?? null;
  }
}

export class DemoTariffs extends BundledTariffs {
  constructor(timezone: string) {
    super("demo", timezone);
  }
}

export class FixtureTariffs extends BundledTariffs {
  constructor(timezone: string) {
    super("fixture", timezone);
  }
}

/** Live OpenEI URDB lookups, falling back to bundled plans on any error. */
export class OpenEITariffs implements TariffSource {
  readonly kind = "openei" as const;
  readonly #apiKey: string;
  readonly #timezone: string;
  readonly #fallback: FixtureTariffs;
  readonly #cache = new Map<string, NormalizedTariff>();

  constructor(apiKey: string, timezone: string) {
    this.#apiKey = apiKey;
    this.#timezone = timezone;
    this.#fallback = new FixtureTariffs(timezone);
  }

  defaultRateId(): string {
    return DEMO_RATE_ID;
  }

  async findPlans(zip: string) {
    try {
      const plans = await fetchRatePlans(zip, this.#apiKey, fetch, { timezone: this.#timezone });
      for (const p of plans) this.#cache.set(p.rateId, p);
      return { plans, source: "openei" as const };
    } catch (err) {
      logError("openei.findPlans", err);
      const fb = await this.#fallback.findPlans(zip);
      return { ...fb, note: "I couldn't reach the OpenEI rate database, so these are bundled plans." };
    }
  }

  async get(rateId: string): Promise<NormalizedTariff | null> {
    const cached = this.#cache.get(rateId) ?? (await this.#fallback.get(rateId));
    if (cached) return cached;
    try {
      const t = await fetchRate(rateId, this.#apiKey, fetch, { timezone: this.#timezone });
      this.#cache.set(rateId, t);
      return t;
    } catch (err) {
      logError("openei.get", err);
      return null;
    }
  }
}
