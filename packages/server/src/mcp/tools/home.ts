import { capitalize, centsPerKwhSpoken, joinAnd, speakTime, the } from "@off-peak/core";
import { z } from "zod";
import { controlDevice } from "../../services/control.ts";
import { homeStatus } from "../../services/status.ts";
import { defineTool } from "../defineTool.ts";
import { deviceRef, deviceStateSchema, timelineSchema } from "../schemas.ts";

export const getHomeStatus = defineTool({
  name: "get_home_status",
  title: "Home status",
  description:
    "Summarize the home right now: mode (home, away, sleep, or only some rooms in use), what is running, what is scheduled, the current price and next price change, and idle devices wasting standby power. " +
    "Use for: 'what's going on at home?', 'what's scheduled tonight?', 'is anything wasting power?', 'show me the plan'.",
  input: {},
  output: {
    view: z.literal("home"),
    mode: z.enum(["home", "away", "sleep", "zone"]),
    activeZones: z.array(z.string()),
    returnAt: z.string().nullable(),
    running: z.array(z.object({ deviceId: z.string(), name: z.string(), powerW: z.number(), until: z.string().nullable() })),
    scheduled: z.array(
      z.object({ stepId: z.string(), planId: z.string(), deviceId: z.string(), name: z.string(), action: z.string(), start: z.string(), end: z.string() }),
    ),
    priceNow: z.object({ centsPerKwh: z.number(), periodName: z.string() }),
    nextChange: z.object({ at: z.string(), centsPerKwh: z.number(), periodName: z.string() }).nullable(),
    idleCandidates: z.array(z.object({ deviceId: z.string(), name: z.string(), zone: z.string(), standbyW: z.number() })),
    powerNowW: z.number(),
    rateName: z.string(),
    isDemoRate: z.boolean(),
    timeline: timelineSchema,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  ui: true,
  async run(_args, rt) {
    const h = await rt.household();
    const tariff = await rt.currentTariff(h);
    const s = await homeStatus(rt, h, tariff);
    const tz = h.timezone;
    const mode =
      s.mode === "away"
        ? `You're away${s.returnAt ? ` until ${speakTime(s.returnAt, tz)}` : ""}`
        : s.mode === "sleep"
          ? "Sleep mode is on"
          : s.mode === "zone"
            ? `Only the ${joinAnd(s.activeZones.map((z) => z.toLowerCase()))} ${s.activeZones.length > 1 ? "are" : "is"} in use`
            : "You're home";
    const bits: string[] = [];
    if (s.running.length) bits.push(`${joinAnd(s.running.map((r) => the(r.name)))} ${s.running.length > 1 ? "are" : "is"} running`);
    const devices = [...new Set(s.scheduled.map((x) => x.deviceId))];
    if (devices.length) bits.push(`${devices.length} ${devices.length === 1 ? "thing is" : "things are"} scheduled, next ${the(s.scheduled[0]!.name)} at ${speakTime(s.scheduled[0]!.start, tz)}`);
    if (s.idleCandidates.length) bits.push(`${s.idleCandidates.length} idle ${s.idleCandidates.length === 1 ? "device is" : "devices are"} on standby`);
    const first = `${mode}${bits.length ? `; ${joinAnd(bits)}` : ""}.`;
    const price = `It's ${s.priceNow.periodName}, ${centsPerKwhSpoken(s.priceNow.centsPerKwh)}${s.nextChange ? ` until ${speakTime(s.nextChange.at, tz)}` : ""}${s.isDemoRate ? " on the demo rate" : ""}.`;
    return { text: `${first} ${capitalize(price)}`, data: s };
  },
});

export const controlDeviceTool = defineTool({
  name: "control_device",
  title: "Turn a device on or off",
  description:
    "Directly turn one device on or off, or set the thermostat (degrees F) or water heater ('eco' or 'normal'). Never-off devices (fridge, router, aquarium) ask for confirmation first. " +
    "Use for: 'turn off the TV', 'switch the office PC back on', 'set the thermostat to 76', 'turn the fish tank off' (asks first).",
  input: {
    device: deviceRef,
    action: z.enum(["on", "off", "set"]),
    value: z.union([z.number(), z.string()]).optional().describe("For 'set': thermostat degrees F, or 'eco' / 'normal' for the water heater"),
    confirm: z.boolean().optional().describe("true only after the user confirmed turning off a protected device"),
  },
  output: {
    device: z.object({ id: z.string(), name: z.string() }),
    before: deviceStateSchema,
    after: deviceStateSchema,
    needsConfirmation: z.boolean(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(args, rt) {
    const r = await rt.withLock(async () => controlDevice(rt, await rt.household(), args));
    rt.changed("control");
    return { text: r.text, data: { device: r.device, before: r.before, after: r.after, needsConfirmation: r.needsConfirmation } };
  },
});
