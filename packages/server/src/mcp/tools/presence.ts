import { joinAnd, speakTime, the } from "@off-peak/core";
import { z } from "zod";
import { arriving, setMode } from "../../services/presence.ts";
import { defineTool } from "../defineTool.ts";
import { timeRef } from "../schemas.ts";

const named = z.object({ deviceId: z.string(), name: z.string() });

function lower(names: string[]): string[] {
  return names.map((n) => the(n));
}

export const setModeTool = defineTool({
  name: "set_mode",
  title: "Set home mode",
  description:
    "Tell Off-Peak who is home: 'away' (everyone left; standby power off, cooling set back; never-off devices and running appliances untouched), 'zone' (only some rooms in use; power down the rest), 'sleep' (lights and TVs off, noisy appliances wait), or 'home' (restore only what Off-Peak turned off). " +
    "Use for: 'we're heading out until 9', 'it's just me in the office', 'we're going to bed', 'we're back'.",
  input: {
    mode: z.enum(["home", "away", "sleep", "zone"]),
    activeZones: z.array(z.string()).optional().describe("For mode 'zone': rooms in use, e.g. ['office']"),
    returnAt: timeRef.optional().describe("For 'away': when people are back, e.g. '21:00'; schedules pre-cooling and restore"),
    confirm: z.boolean().optional().describe("true when the user confirmed devices that need asking first"),
  },
  output: {
    mode: z.enum(["home", "away", "sleep", "zone"]),
    activeZones: z.array(z.string()),
    actions: z.array(z.object({ deviceId: z.string(), name: z.string(), action: z.string(), reason: z.string() })),
    keptOn: z.array(z.object({ deviceId: z.string(), name: z.string(), reason: z.string() })),
    needsConfirmation: z.array(named),
    restored: z.array(named),
    arrival: z.object({ restoreAt: z.string(), preconditionAt: z.string(), note: z.string() }).nullable(),
    undoToken: z.string(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(args, rt) {
    const r = await rt.withLock(async () => {
      const h = await rt.household();
      return setMode(rt, h, await rt.currentTariff(h), args);
    });
    rt.changed("mode");
    const offs = r.actions.filter((a) => a.action === "off").length;
    const protectedOn = r.keptOn.filter((k) => !/cycle|charging/.test(k.reason)).map((k) => k.name);
    const busy = r.keptOn.filter((k) => /cycle|charging/.test(k.reason)).map((k) => k.name);
    let text: string;
    if (r.mode === "home") {
      text = r.restored.length ? `Welcome home: I turned ${r.restored.length} ${r.restored.length === 1 ? "thing" : "things"} back on the way you left ${r.restored.length === 1 ? "it" : "them"}.` : "Welcome home; there was nothing to turn back on.";
    } else if (r.needsConfirmation.length && r.actions.length === 0) {
      text = `Before I switch anything off: ${joinAnd(lower(r.needsConfirmation.map((n) => n.name)))} ${r.needsConfirmation.length > 1 ? "are" : "is"} set to ask first. Should I go ahead?`;
    } else {
      const lead =
        r.mode === "away"
          ? `Away mode is on: I turned off ${offs} ${offs === 1 ? "thing" : "things"}`
          : r.mode === "zone"
            ? `Okay, just the ${joinAnd(r.activeZones.map((z) => z.toLowerCase()))}: I turned off ${offs} ${offs === 1 ? "thing" : "things"} in the other rooms`
            : `Good night: I turned off ${offs} ${offs === 1 ? "thing" : "things"}, and noisy appliances will wait for morning`;
      const kept = [
        protectedOn.length ? `${joinAnd(lower(protectedOn))} stay on` : "",
        busy.length ? `${joinAnd(lower(busy))} keeps going` : "",
      ].filter(Boolean);
      const second = r.arrival ? ` ${r.arrival.note}` : r.needsConfirmation.length ? ` ${joinAnd(lower(r.needsConfirmation.map((n) => n.name)))} need your okay first.` : "";
      text = `${lead}${kept.length ? `, and ${joinAnd(kept)}` : ""}.${second}`;
    }
    return { text, data: r };
  },
});

export const arrivingTool = defineTool({
  name: "arriving",
  title: "Someone is coming home",
  description:
    "Schedule the home for someone's arrival: pre-cool 30 minutes ahead (never during peak; waits for peak to end) and restore what Off-Peak turned off at arrival time. " +
    "Use for: 'I'll be home at 9', 'we're 20 minutes out', 'heading home now'.",
  input: {
    eta: z.union([z.string(), z.number()]).describe("Arrival time as 'HH:mm' (24-hour), '9 PM', or minutes from now as a number"),
  },
  output: { restoreAt: z.string(), preconditionAt: z.string(), notes: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(args, rt) {
    const r = await rt.withLock(async () => {
      const h = await rt.household();
      return arriving(rt, h, await rt.currentTariff(h), args.eta);
    });
    rt.changed("arriving");
    const tz = rt.timezone;
    const note = r.notes.split(". ")[0]!.replace(/\.$/, "");
    const text = `${note}. Everything else comes back on at ${speakTime(r.restoreAt, tz)}.`;
    return { text, data: r };
  },
});
