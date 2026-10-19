import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Device, DeviceState } from "@off-peak/core";
import type { Config } from "../config.ts";
import { fixturesDir } from "../fixtures.ts";
import { logError } from "../log.ts";
import type { DeviceGateway } from "../ports.ts";
import { nextState } from "./simDevices.ts";

interface Mapping {
  entity_id: string;
}

/**
 * Optional Home Assistant gateway: REST `POST /api/services/<domain>/<service>` with a long-lived token.
 * Device ids map to entity ids via fixtures/ha-map.json; unmapped devices fall back to the simulation.
 */
export class HomeAssistantDevices implements DeviceGateway {
  readonly kind = "homeassistant" as const;
  readonly #url: string;
  readonly #token: string;
  readonly #map: Record<string, Mapping>;
  readonly #fetch: typeof fetch;

  constructor(config: Config, fetchImpl: typeof fetch = fetch) {
    if (!config.haUrl || !config.haToken) throw new Error("DEVICES=homeassistant needs HA_URL and HA_TOKEN");
    this.#url = config.haUrl.replace(/\/$/, "");
    this.#token = config.haToken;
    const file = join(fixturesDir(), "ha-map.json");
    this.#map = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, Mapping>) : {};
    this.#fetch = fetchImpl;
  }

  async #call(domain: string, service: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.#fetch(`${this.#url}/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.#token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Home Assistant ${domain}.${service} failed: HTTP ${res.status}`);
  }

  async apply(device: Device, change: Partial<DeviceState>, at: Date): Promise<DeviceState> {
    const m = this.#map[device.id];
    const next = nextState(device, change, at);
    if (!m) return next;
    const entity_id = m.entity_id;
    const domain = entity_id.split(".")[0]!;
    try {
      if (change.on !== undefined) await this.#call(domain === "climate" ? "climate" : "homeassistant", change.on ? "turn_on" : "turn_off", { entity_id });
      if (change.setpointF !== undefined) await this.#call("climate", "set_temperature", { entity_id, temperature: change.setpointF });
      if (change.ecoMode !== undefined) await this.#call("water_heater", "set_operation_mode", { entity_id, operation_mode: change.ecoMode ? "eco" : "electric" });
    } catch (err) {
      logError("homeassistant", err);
      throw err;
    }
    return next;
  }
}
