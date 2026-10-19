import {
  capitalize,
  isNeverOff,
  keptOnReason,
  OffPeakError,
  requireDevice,
  the,
  type DeviceState,
  type Household,
} from "@off-peak/core";
import type { Runtime } from "../runtime.ts";
import { changeDevice } from "./devices.ts";
import { activeSteps } from "./status.ts";

export interface ControlInput {
  device: string;
  action: "on" | "off" | "set";
  value?: number | string | boolean;
  confirm?: boolean;
}

export interface ControlResult {
  device: { id: string; name: string };
  before: Partial<DeviceState>;
  after: Partial<DeviceState>;
  needsConfirmation: boolean;
  text: string;
}

/** A direct user request. Never-off devices need explicit confirmation (enforced here, server-side). */
export async function controlDevice(rt: Runtime, h: Household, input: ControlInput): Promise<ControlResult> {
  const d = requireDevice(h, input.device);
  const name = the(d.name);

  if (input.action === "off" && isNeverOff(h, d) && !input.confirm) {
    return {
      device: { id: d.id, name: d.name },
      before: { on: d.state.on },
      after: { on: d.state.on },
      needsConfirmation: true,
      text: `${capitalize(name)} is set to never turn off because it ${keptOnReason(d).replace("never off", "is protected")}. Are you sure you want it off?`,
    };
  }

  let change: Partial<DeviceState>;
  let text: string;
  if (input.action === "on") {
    change = { on: true };
    text = `Okay, ${name} is on.`;
  } else if (input.action === "off") {
    change = { on: false };
    text = `Okay, ${name} is off.`;
    // Turning off a running appliance cancels the rest of its scheduled step.
    if (d.state.running) {
      const running = (await activeSteps(rt)).find((a) => a.status === "running" && a.plan.steps.find((s) => s.id === a.stepId)?.deviceId === d.id);
      if (running) {
        const { cancelPlan } = await import("./plans.ts");
        await cancelPlan(rt, h, { stepId: running.stepId });
      }
    }
  } else {
    if (d.kind === "thermostat") {
      const f = Number(input.value);
      if (!Number.isFinite(f) || f < 55 || f > 90) throw new OffPeakError("invalid_input", "What temperature should I set, between 55 and 90 degrees?");
      change = { setpointF: Math.round(f) };
      text = `Okay, the thermostat is set to ${Math.round(f)} degrees.`;
    } else if (d.kind === "water_heater") {
      const eco = input.value === true || /^(eco|on|true|yes)$/i.test(String(input.value));
      change = { ecoMode: eco };
      text = `Okay, the water heater is ${eco ? "in eco mode" : "back to normal"}.`;
    } else {
      throw new OffPeakError("invalid_input", `I can only turn ${name} on or off.`);
    }
  }

  const before = { ...d.state };
  const entry = await changeDevice(rt, h, d, change, { source: "user", action: input.action, reason: "you asked" });
  await rt.store.saveHousehold(h);
  return { device: { id: d.id, name: d.name }, before: entry?.before ?? before, after: entry?.after ?? d.state, needsConfirmation: false, text };
}
