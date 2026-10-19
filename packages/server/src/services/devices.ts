import { iso, type Device, type DeviceState, type Household, type LedgerEntry, type LedgerSource } from "@off-peak/core";
import type { Runtime } from "../runtime.ts";

export interface ChangeInfo {
  source: LedgerSource;
  action: string;
  reason: string;
  estSavedCents?: number;
  estimate?: boolean;
  groupId?: string;
  undoOf?: string;
  meta?: Record<string, unknown>;
  /** When the change happened (defaults to clock now); scheduled jobs pass their own time. */
  at?: Date;
}

function pick(state: DeviceState, keys: (keyof DeviceState)[]): Partial<DeviceState> {
  const out: Partial<DeviceState> = {};
  for (const k of keys) if (state[k] !== undefined) (out as Record<string, unknown>)[k] = state[k];
  return out;
}

/**
 * Apply a device change through the gateway, update `h` in place, and (unless `info` is null)
 * append a ledger entry with before/after state so it can be explained and undone.
 */
export async function changeDevice(
  rt: Runtime,
  h: Household,
  device: Device,
  change: Partial<DeviceState>,
  info: ChangeInfo | null,
): Promise<LedgerEntry | null> {
  const at = info?.at ?? rt.clock.now();
  const keys = [...new Set<keyof DeviceState>(["on", "powerW", ...(Object.keys(change) as (keyof DeviceState)[])])];
  const before = pick(device.state, keys);
  const next = await rt.devices.apply(device, change, at);
  const target = h.devices.find((d) => d.id === device.id) ?? device;
  target.state = next;
  device.state = next;
  if (!info) return null;
  const entry: LedgerEntry = {
    id: rt.newId("act"),
    at: iso(at.getTime(), h.timezone),
    deviceId: device.id,
    action: info.action,
    reason: info.reason,
    source: info.source,
    estSavedCents: info.estSavedCents ?? 0,
    estimate: info.estimate ?? false,
    before,
    after: pick(next, keys),
    ...(info.groupId ? { groupId: info.groupId } : {}),
    ...(info.undoOf ? { undoOf: info.undoOf } : {}),
    ...(info.meta ? { meta: info.meta } : {}),
  };
  await rt.store.appendLedger([entry]);
  return entry;
}

/** A ledger entry that isn't tied to one device's state (mode changes, plan applied, notes). */
export async function note(
  rt: Runtime,
  h: Household,
  fields: Omit<LedgerEntry, "id" | "at" | "estSavedCents" | "estimate"> & Partial<Pick<LedgerEntry, "estSavedCents" | "estimate">> & { at?: Date },
): Promise<LedgerEntry> {
  const { at, ...rest } = fields;
  const entry: LedgerEntry = {
    id: rt.newId("act"),
    at: iso((at ?? rt.clock.now()).getTime(), h.timezone),
    estSavedCents: 0,
    estimate: false,
    ...rest,
  };
  await rt.store.appendLedger([entry]);
  return entry;
}
