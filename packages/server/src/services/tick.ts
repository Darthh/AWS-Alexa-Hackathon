import { iso } from "@off-peak/core";
import type { Runtime } from "../runtime.ts";
import { runDueJobs } from "./plans.ts";
import { getOccupancy, idleSweep } from "./presence.ts";

const MINUTE = 60_000;

/** Per tick: run due jobs (local scheduler), simulate the world, sweep idle standby loads. */
export async function onTick(rt: Runtime, now: Date, _prev: Date): Promise<void> {
  const h = await rt.household();
  if (rt.scheduler.kind === "local") await runDueJobs(rt, h, now);

  let dirty = false;
  if (rt.devices.kind === "sim") {
    // People present in a zone keep generating motion.
    const occupancy = await getOccupancy(rt);
    for (const z of h.zones) {
      if (!occupancy[z.id]) continue;
      const last = z.lastMotionAt ? Date.parse(z.lastMotionAt) : 0;
      if (now.getTime() - last >= MINUTE) {
        z.lastMotionAt = iso(now.getTime(), h.timezone);
        dirty = true;
      }
    }
    // EV state of charge follows the active charge step.
    for (const d of h.devices) {
      if (!d.battery || !d.state.running) continue;
      const c = await rt.store.getMeta<{ startMs: number; endMs: number; startSoc: number; endSoc: number }>(`sim.charge.${d.id}`);
      if (!c) continue;
      const f = Math.min(1, Math.max(0, (now.getTime() - c.startMs) / (c.endMs - c.startMs)));
      const soc = Math.round((c.startSoc + f * (c.endSoc - c.startSoc)) * 10) / 10;
      if (soc !== d.battery.socPercent) {
        d.battery.socPercent = soc;
        dirty = true;
      }
    }
  }

  if ((await idleSweep(rt, h, now)) > 0) dirty = true;
  if (dirty) await rt.store.saveHousehold(h);
  if (rt.clock.kind === "sim") await rt.store.setMeta("sim.now", now.toISOString());
}
