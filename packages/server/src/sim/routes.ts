import { iso, nextOccurrence, parseHHmm, requireZone, OffPeakError } from "@off-peak/core";
import express, { type Request, type Response, Router } from "express";
import { SimClock } from "../clock.ts";
import { logError } from "../log.ts";
import type { Runtime } from "../runtime.ts";
import { getOccupancy, setOccupancy } from "../services/presence.ts";
import { snapshot } from "../services/snapshot.ts";

function fail(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

/**
 * Simulator admin routes: they represent the physical world (clock, people, reset), not MCP tools.
 * Mounted only when SIM_ADMIN=1.
 */
export function simRouter(rt: Runtime): Router {
  const r = Router();
  r.use(express.json({ limit: "64kb" }));

  r.get("/state", async (_req, res) => {
    res.json(await snapshot(rt));
  });

  r.post("/clock", async (req: Request, res: Response) => {
    const clock = rt.clock;
    if (!(clock instanceof SimClock)) return fail(res, 409, "The real clock can't be changed.");
    const { action, value } = (req.body ?? {}) as { action?: string; value?: unknown };
    try {
      if (action === "play") clock.play();
      else if (action === "pause") clock.pause();
      else if (action === "speed") clock.setSpeed(Number(value));
      else if (action === "set") {
        const v = String(value ?? "");
        let target: number;
        if (/^\d{1,2}:\d{2}$/.test(v)) {
          parseHHmm(v);
          target = nextOccurrence(v, clock.now(), rt.timezone);
        } else if (/^\+\d+$/.test(v)) target = clock.now().getTime() + Number(v.slice(1)) * 60_000;
        else target = Date.parse(v);
        if (!Number.isFinite(target)) return fail(res, 400, "value must be HH:mm, +minutes, or an ISO time");
        await clock.set(new Date(target));
      } else return fail(res, 400, "action must be play | pause | set | speed");
      rt.changed("clock");
      res.json({ ...clock.state(), local: iso(clock.now().getTime(), rt.timezone) });
    } catch (err) {
      fail(res, 400, err instanceof Error ? err.message : String(err));
    }
  });

  r.post("/motion", async (req, res) => {
    const { zoneId, present } = (req.body ?? {}) as { zoneId?: string; present?: boolean };
    if (!zoneId) return fail(res, 400, "zoneId is required");
    try {
      const zone = await rt.withLock(async () => {
        const h = await rt.household();
        const z = requireZone(h, zoneId);
        if (present !== undefined) await setOccupancy(rt, z.id, present);
        if (present !== false) {
          z.lastMotionAt = iso(rt.clock.now().getTime(), h.timezone);
          await rt.store.saveHousehold(h);
        }
        return z;
      });
      rt.changed("motion");
      res.json({ zone, occupancy: await getOccupancy(rt) });
    } catch (err) {
      fail(res, err instanceof OffPeakError ? 404 : 500, err instanceof Error ? err.message : String(err));
    }
  });

  r.post("/reset", async (_req, res) => {
    await rt.reset();
    res.json(await snapshot(rt));
  });

  // Server-sent events: a full snapshot on connect and after every change (throttled).
  r.get("/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const send = async () => {
      timer = undefined;
      if (closed) return;
      try {
        res.write(`event: snapshot\ndata: ${JSON.stringify(await snapshot(rt))}\n\n`);
      } catch (err) {
        logError("sse", err);
      }
    };
    const onChange = () => {
      timer ??= setTimeout(send, 200);
    };
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    rt.events.on("changed", onChange);
    req.on("close", () => {
      closed = true;
      clearInterval(keepAlive);
      if (timer) clearTimeout(timer);
      rt.events.off("changed", onChange);
    });
    void send();
  });

  return r;
}
