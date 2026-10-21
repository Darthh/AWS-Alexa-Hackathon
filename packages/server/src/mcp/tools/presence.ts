import { capitalize, joinAnd, speakTime, the } from "@off-peak/core";
import { z } from "zod";
import { arriving, setMode } from "../../services/presence.ts";
import { defineTool } from "../defineTool.ts";
import { timeRef } from "../schemas.ts";

const named = z.object({ deviceId: z.string(), name: z.string() });

function lower(names: string[]): string[] {
  return names.map((n) => the(n));
}

/** "the fridge stays on" / "the fridge, Wi-Fi router, and aquarium stay on". */
function staysOn(names: string[]): string {
  const items = names.map((n, i) => (i === 0 ? the(n) : the(n).slice(4)));
  return `${joinAnd(items)} ${names.length === 1 ? "stays" : "stay"} on`;
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
    const asking = lower(r.needsConfirmation.map((n) => n.name));
    // Rules > presence: a device that must be asked about gets the question instead of the arrival note
    // (the arrival is still scheduled and returned in structuredContent).
    const askQuestion = asking.length
      ? `${capitalize(joinAnd(asking))} ${asking.length > 1 ? "are" : "is"} set to ask first; should I turn ${asking.length > 1 ? "them" : "it"} off too?`
      : "";
    let text: string;
    if (r.mode === "home") {
      text = r.restored.length ? `Welcome home: I turned ${r.restored.length} ${r.restored.length === 1 ? "thing" : "things"} back on the way you left ${r.restored.length === 1 ? "it" : "them"}.` : "Welcome home; there was nothing to turn back on.";
    } else if (asking.length && r.actions.length === 0) {
      text = `Before I switch anything off: ${joinAnd(asking)} ${asking.length > 1 ? "are" : "is"} set to ask first. Should I go ahead?`;
    } else {
      const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;
      const lead =
        r.mode === "away"
          ? `Away mode is on: I turned off ${things(offs)}`
          : r.mode === "zone"
            ? `Okay, just the ${joinAnd(r.activeZones.map((z) => z.toLowerCase()))}: I turned off ${things(offs)} in the other rooms`
            : `Good night: I turned off ${things(offs)}, and noisy appliances will wait for morning`;
      const kept = [
        protectedOn.length ? staysOn(protectedOn) : "",
        busy.length ? `${joinAnd(lower(busy))} ${busy.length === 1 ? "keeps" : "keep"} running` : "",
      ].filter(Boolean);
      const second = askQuestion ? ` ${askQuestion}` : r.arrival ? ` ${r.arrival.note}` : "";
      text = `${lead}${kept.length ? `, but ${kept.join(", and ")}` : ""}.${second}`;
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
    const text = r.willRestore ? `${note}. Everything else comes back on at ${speakTime(r.restoreAt, tz)}.` : `${note}.`;
    return { text, data: { restoreAt: r.restoreAt, preconditionAt: r.preconditionAt, notes: r.notes } };
  },
});
