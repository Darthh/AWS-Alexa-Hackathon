import type { Device, DeviceState } from "@off-peak/core";
import type { DeviceGateway } from "../ports.ts";

const ACTIVE_WHEN_ON = new Set(["tv", "console", "light", "fan", "fridge", "router", "aquarium"]);

/** Draw when switched on without an explicit power (TV → watching, plug → standby). */
export function defaultOnPowerW(d: Device): number {
  if (ACTIVE_WHEN_ON.has(d.kind)) return Math.round(d.ratedKw * 1000);
  if (d.kind === "thermostat" || d.kind === "water_heater") return 0;
  return d.standbyW ?? Math.round(d.ratedKw * 1000);
}

/** Pure state transition for the simulated home. */
export function nextState(d: Device, change: Partial<DeviceState>, at: Date): DeviceState {
  const s: DeviceState = { ...d.state, ...change };
  if (change.on === false) {
    s.running = false;
    s.powerW = 0;
  } else if (change.on === true && change.powerW === undefined && !d.state.on) {
    s.powerW = defaultOnPowerW(d);
  }
  if (change.running === false && change.powerW === undefined) s.powerW = s.on ? (d.standbyW ?? 0) : 0;
  if (change.running === true && change.powerW === undefined) s.powerW = Math.round(d.ratedKw * 1000);
  if (s.on && (change.on || change.running)) s.lastActiveAt = at.toISOString();
  return s;
}

export class SimDevices implements DeviceGateway {
  readonly kind = "sim" as const;
  async apply(device: Device, change: Partial<DeviceState>, at: Date): Promise<DeviceState> {
    return nextState(device, change, at);
  }
}
