import { formatCentsValue, priceAt, toDateTime, type Instant } from "tou-rates";
import { slots as priceSlots } from "tou-rates";
import { OffPeakError } from "./errors.ts";
import { capitalize, dollars, speakTime, the } from "./format.ts";
import { BASE_LOAD_KW, deadlineRuleFor, maxLoadRule, rulesOf, type RuleOf } from "./household.ts";
import { alignUp, dailyIntervals, HOUR, iso, ms, nextOccurrence, overlaps, SLOT_MS } from "./time.ts";
import type {
  Conflict,
  ConflictOption,
  Device,
  DeviceId,
  Household,
  NormalizedTariff,
  Plan,
  PlanStep,
  Rule,
  TaskRequest,
} from "./types.ts";

export interface PlanOptions {
  id?: string;
  baseLoadKw?: number;
  /** Rules to ignore while planning (e.g. after the user picks "allow it during quiet hours"). */
  relaxRuleIds?: string[];
}

interface Slot {
  start: number;
  end: number;
  price: number;
  period: string;
}

interface Task {
  order: number;
  device: Device;
  req: TaskRequest;
  interruptible: boolean;
  nSlots: number;
  kw: number;
  energy: number;
  earliest: number;
  finishBy: number;
  finishBySource: "request" | "rule" | "horizon";
  deadlineRule?: RuleOf<"deadline">;
  targetPercent?: number;
  noisy: boolean;
  after?: DeviceId;
  successors: DeviceId[];
  latestFinish: number;
}

interface Placement {
  idx: number[];
  kw: number[];
  cost: number;
}

interface Ctx {
  h: Household;
  tariff: NormalizedTariff;
  tz: string;
  start: number;
  slots: Slot[];
  quiet: [number, number][];
  quietRule?: RuleOf<"quiet_hours">;
  maxLoad?: number;
  maxLoadRuleId?: string;
  base: number;
  load: number[];
  placedEnd: Map<DeviceId, number>;
}

interface PlaceOpts {
  ignoreQuiet?: boolean;
  ignoreLoad?: boolean;
  finishBy?: number;
  earliest?: number;
  energy?: number;
}

const EPS = 1e-9;
const SLOT_H = SLOT_MS / HOUR;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Integer cents, immune to float noise like 24.4999999 (money rounds at the end of each step). */
const roundCents = (c: number) => Math.round(Math.round(c * 1e6) / 1e6);

// ───────────────────────── task resolution ─────────────────────────

function resolveTasks(h: Household, now: number, requests: TaskRequest[], rules: Rule[]): Task[] {
  const byDevice = new Map<DeviceId, TaskRequest>();
  for (const r of requests) byDevice.set(r.deviceId, { ...byDevice.get(r.deviceId), ...r });
  const reqs = [...byDevice.values()];

  const washer = reqs.find((r) => h.devices.find((d) => d.id === r.deviceId)?.kind === "washer");
  const tasks: Task[] = reqs.map((req, order) => {
    const device = h.devices.find((d) => d.id === req.deviceId);
    if (!device) throw new OffPeakError("not_found", "I couldn't find one of those appliances.", { deviceId: req.deviceId });
    const deadlineRule = deadlineRuleFor(rules, device.id);
    const earliest = req.earliestStart ? Math.max(ms(req.earliestStart), now) : now;
    let finishBy = req.finishBy ? ms(req.finishBy) : NaN;
    let finishBySource: Task["finishBySource"] = "request";
    if (Number.isNaN(finishBy) && deadlineRule) {
      finishBy = nextOccurrence(deadlineRule.by, now, h.timezone, deadlineRule.days);
      finishBySource = "rule";
    }
    if (Number.isNaN(finishBy)) finishBySource = "horizon";

    let after = req.after;
    if (!after && device.kind === "dryer" && washer) after = washer.deviceId;

    if (device.battery) {
      const target = req.targetPercent ?? deadlineRule?.targetPercent ?? 80;
      const energy = Math.max(0, ((target - device.battery.socPercent) / 100) * device.battery.capacityKwh);
      return {
        order, device, req, interruptible: true, nSlots: 0, kw: device.battery.maxKw, energy,
        earliest, finishBy, finishBySource, deadlineRule, targetPercent: target,
        noisy: Boolean(device.noisy), after, successors: [], latestFinish: finishBy,
      };
    }
    if (!device.cycle) {
      throw new OffPeakError("invalid_input", `${capitalize(the(device.name))} isn't an appliance I can schedule.`, { deviceId: device.id });
    }
    const nSlots = Math.max(1, Math.ceil(device.cycle.durationMin / 15));
    return {
      order, device, req, interruptible: device.cycle.interruptible, nSlots,
      kw: device.cycle.energyKwh / (nSlots * SLOT_H), energy: device.cycle.energyKwh,
      earliest, finishBy, finishBySource, deadlineRule, noisy: Boolean(device.noisy), after,
      successors: [], latestFinish: finishBy,
    };
  });

  const ids = new Set(tasks.map((t) => t.device.id));
  for (const t of tasks) {
    if (t.after && !ids.has(t.after)) t.after = undefined;
    if (t.after) tasks.find((x) => x.device.id === t.after)!.successors.push(t.device.id);
  }
  return tasks;
}

function topoOrder(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.device.id, t]));
  const done = new Set<DeviceId>();
  const out: Task[] = [];
  while (out.length < tasks.length) {
    const ready = tasks
      .filter((t) => !done.has(t.device.id) && (!t.after || done.has(t.after) || !byId.has(t.after)))
      .sort((a, b) => a.latestFinish - b.latestFinish || a.order - b.order);
    if (ready.length === 0) throw new OffPeakError("invalid_input", "Those appliances depend on each other in a loop.");
    out.push(ready[0]!);
    done.add(ready[0]!.device.id);
  }
  return out;
}

// ───────────────────────── placement ─────────────────────────

function firstIdx(ctx: Ctx, t: number): number {
  return Math.max(0, Math.ceil((t - ctx.start) / SLOT_MS - EPS));
}

function fixedCandidates(task: Task, ctx: Ctx, o: PlaceOpts = {}): { i: number; cost: number }[] {
  const finishBy = o.finishBy ?? task.latestFinish;
  const predEnd = task.after ? (ctx.placedEnd.get(task.after) ?? -Infinity) : -Infinity;
  const begin = firstIdx(ctx, Math.max(o.earliest ?? task.earliest, predEnd));
  const out: { i: number; cost: number }[] = [];
  for (let i = begin; i + task.nSlots <= ctx.slots.length; i++) {
    const end = ctx.slots[i + task.nSlots - 1]!.end;
    if (end > finishBy) break;
    if (task.noisy && !o.ignoreQuiet && overlaps(ctx.slots[i]!.start, end, ctx.quiet)) continue;
    let ok = true;
    let cost = 0;
    for (let k = i; k < i + task.nSlots; k++) {
      if (!o.ignoreLoad && ctx.maxLoad !== undefined && ctx.load[k]! + task.kw + ctx.base > ctx.maxLoad + EPS) {
        ok = false;
        break;
      }
      cost += ctx.slots[k]!.price * task.kw * SLOT_H;
    }
    if (ok) out.push({ i, cost });
  }
  return out;
}

function bestOf(cands: { i: number; cost: number }[]): { i: number; cost: number } | null {
  let best: { i: number; cost: number } | null = null;
  for (const c of cands) if (!best || c.cost < best.cost - EPS) best = c;
  return best;
}

function fixedPlacement(task: Task, i: number, cost: number): Placement {
  return { idx: Array.from({ length: task.nSlots }, (_, k) => i + k), kw: Array(task.nSlots).fill(task.kw), cost };
}

/** Cheapest slots first (ties → earlier), up to max power and remaining load headroom. */
function interruptiblePlacement(task: Task, ctx: Ctx, o: PlaceOpts = {}): { placement: Placement | null; maxEnergy: number } {
  const finishBy = o.finishBy ?? task.latestFinish;
  const energy = o.energy ?? task.energy;
  const predEnd = task.after ? (ctx.placedEnd.get(task.after) ?? -Infinity) : -Infinity;
  const begin = firstIdx(ctx, Math.max(o.earliest ?? task.earliest, predEnd));
  const cands: { k: number; avail: number }[] = [];
  for (let k = begin; k < ctx.slots.length && ctx.slots[k]!.end <= finishBy; k++) {
    const s = ctx.slots[k]!;
    if (task.noisy && !o.ignoreQuiet && overlaps(s.start, s.end, ctx.quiet)) continue;
    const headroom = o.ignoreLoad || ctx.maxLoad === undefined ? Infinity : ctx.maxLoad - ctx.base - ctx.load[k]!;
    const avail = Math.min(task.kw, headroom);
    if (avail > EPS) cands.push({ k, avail });
  }
  cands.sort((a, b) => ctx.slots[a.k]!.price - ctx.slots[b.k]!.price || a.k - b.k);
  let remaining = energy;
  const chosen: { k: number; kw: number }[] = [];
  for (const c of cands) {
    if (remaining <= EPS) break;
    const e = Math.min(c.avail * SLOT_H, remaining);
    chosen.push({ k: c.k, kw: e / SLOT_H });
    remaining -= e;
  }
  const maxEnergy = cands.reduce((s, c) => s + c.avail * SLOT_H, 0);
  if (remaining > 1e-6) return { placement: null, maxEnergy };
  chosen.sort((a, b) => a.k - b.k);
  const cost = chosen.reduce((s, c) => s + ctx.slots[c.k]!.price * c.kw * SLOT_H, 0);
  return { placement: { idx: chosen.map((c) => c.k), kw: chosen.map((c) => c.kw), cost }, maxEnergy };
}

/** Washer → dryer: choose both starts together so the pair is cheapest overall. */
function jointPlacement(a: Task, b: Task, ctx: Ctx): [Placement, Placement] | null {
  const aCands = fixedCandidates(a, ctx);
  const bCands = fixedCandidates(b, ctx, { earliest: b.earliest });
  if (!aCands.length || !bCands.length) return null;
  const bestFrom: ({ i: number; cost: number } | null)[] = Array(ctx.slots.length + 2).fill(null);
  const byStart = new Map(bCands.map((c) => [c.i, c]));
  for (let j = ctx.slots.length; j >= 0; j--) {
    const here = byStart.get(j) ?? null;
    const later = bestFrom[j + 1] ?? null;
    bestFrom[j] = here && (!later || here.cost <= later.cost + EPS) ? here : later;
  }
  let best: { a: { i: number; cost: number }; b: { i: number; cost: number }; total: number } | null = null;
  for (const ac of aCands) {
    const bc = bestFrom[ac.i + a.nSlots];
    if (!bc) continue;
    const total = ac.cost + bc.cost;
    if (!best || total < best.total - EPS) best = { a: ac, b: bc, total };
  }
  if (!best) return null;
  return [fixedPlacement(a, best.a.i, best.a.cost), fixedPlacement(b, best.b.i, best.b.cost)];
}

function commit(task: Task, p: Placement, ctx: Ctx): void {
  p.idx.forEach((k, n) => {
    ctx.load[k]! += p.kw[n]!;
  });
  ctx.placedEnd.set(task.device.id, ctx.slots[p.idx.at(-1)!]!.end);
}

/** Latest finish for predecessors so their successors can still fit (ignoring load). */
function tightenLatestFinish(tasks: Task[], ctx: Ctx): void {
  const byId = new Map(tasks.map((t) => [t.device.id, t]));
  const order = topoOrder(tasks).reverse();
  for (const t of order) {
    for (const sid of t.successors) {
      const s = byId.get(sid)!;
      let latestStart: number;
      if (s.interruptible) {
        latestStart = s.latestFinish - (s.energy / s.kw) * HOUR;
      } else {
        const c = fixedCandidates(s, ctx, { ignoreLoad: true, earliest: s.earliest });
        if (!c.length) continue;
        latestStart = ctx.slots[c.at(-1)!.i]!.start;
      }
      t.latestFinish = Math.min(t.latestFinish, latestStart);
    }
  }
}

// ───────────────────────── baseline ─────────────────────────

/** "Run it all now": ASAP in dependency order, ignoring price, quiet hours and load. */
function baselineCosts(tasks: Task[], ctx: Ctx): Map<DeviceId, number> {
  const ends = new Map<DeviceId, number>();
  const costs = new Map<DeviceId, number>();
  for (const t of topoOrder(tasks)) {
    let at = Math.max(ctx.start, alignUp(t.earliest), t.after ? (ends.get(t.after) ?? ctx.start) : ctx.start);
    let cost = 0;
    if (t.interruptible) {
      let remaining = t.energy;
      while (remaining > EPS) {
        const e = Math.min(t.kw * SLOT_H, remaining);
        cost += priceAt(ctx.tariff, at).centsPerKwh * e;
        remaining -= e;
        at += SLOT_MS;
      }
    } else {
      for (let k = 0; k < t.nSlots; k++) {
        cost += priceAt(ctx.tariff, at).centsPerKwh * t.kw * SLOT_H;
        at += SLOT_MS;
      }
    }
    ends.set(t.device.id, at);
    costs.set(t.device.id, roundCents(cost));
  }
  return costs;
}

// ───────────────────────── reasons ─────────────────────────

function nextQuietStart(ctx: Ctx, after: number): number | undefined {
  return ctx.quiet.map(([a]) => a).filter((a) => a >= after).sort((x, y) => x - y)[0];
}

function fixedReason(t: Task, p: Placement, ctx: Ctx, byId: Map<DeviceId, Task>, placements: Map<DeviceId, Placement>): string {
  const time = (x: number) => speakTime(x, ctx.tz);
  const i = p.idx[0]!;
  const s = ctx.slots[i]!;
  const end = ctx.slots[p.idx.at(-1)!]!.end;
  const prev = i > 0 ? ctx.slots[i - 1] : undefined;
  const startsNow = s.start === ctx.start;
  const succ = t.successors.map((id) => byId.get(id)!).find((x) => placements.has(x.device.id));
  const ownBest = bestOf(fixedCandidates(t, { ...ctx, load: ctx.load.map(() => 0) }, { finishBy: t.finishBy, ignoreLoad: true }));
  const forcedBySuccessor = succ && ownBest && ownBest.cost < p.cost - EPS;

  let first: string;
  let second: string;
  if (forcedBySuccessor) {
    const q = succ.noisy ? nextQuietStart(ctx, s.start) : undefined;
    const limit = q !== undefined && q <= succ.finishBy ? `before quiet hours at ${time(q)}` : `by ${time(succ.latestFinish)}`;
    first = `Starts ${startsNow ? "now" : `at ${time(s.start)}`} so ${the(succ.device.name)} can finish ${limit}`;
    second = `done by ${time(end)}`;
  } else {
    if (prev && prev.price > s.price + EPS) {
      first = prev.period === "peak" ? `Peak ends at ${time(s.start)}` : `${capitalize(s.period)} starts at ${time(s.start)}`;
    } else {
      const by = t.finishBySource === "horizon" ? "" : ` before ${time(t.finishBy)}`;
      first = `${capitalize(s.period)} ${startsNow ? "now" : `at ${time(s.start)}`} is the cheapest time${by}`;
    }
    const q = t.noisy ? nextQuietStart(ctx, s.start) : undefined;
    if (q !== undefined && end <= q && q - end < 6 * HOUR) second = `finishes at ${time(end)}, before quiet hours`;
    else if (t.after) second = `after ${the(byId.get(t.after)?.device.name ?? "previous load")}, done by ${time(end)}`;
    else second = `done by ${time(end)}`;
  }
  return `${first}; ${second}.`;
}

function chargeReason(t: Task, step: { start: number; end: number }, lastEnd: number, ctx: Ctx): string {
  const s = ctx.slots[firstIdx(ctx, step.start)]!;
  const time = (x: number) => speakTime(x, ctx.tz);
  const head = `${capitalize(s.period)} at ${formatCentsValue(s.price)}¢/kWh is the cheapest time to charge`;
  const deadline = t.finishBySource === "horizon" ? "" : `, before the ${time(t.finishBy)} deadline`;
  return `${head}; reaches ${t.targetPercent}% by ${time(lastEnd)}${deadline}.`;
}

// ───────────────────────── conflicts ─────────────────────────

function placementCost(t: Task, ctx: Ctx, o: PlaceOpts): number | null {
  return placementInfo(t, ctx, o)?.cost ?? null;
}

/** Cost and finish time of the best placement under relaxed options (for conflict options). */
function placementInfo(t: Task, ctx: Ctx, o: PlaceOpts): { cost: number; end: number } | null {
  if (t.interruptible) {
    const p = interruptiblePlacement(t, ctx, o).placement;
    return p && p.idx.length ? { cost: p.cost, end: ctx.slots[Math.max(...p.idx)]!.end } : null;
  }
  const b = bestOf(fixedCandidates(t, ctx, o));
  return b ? { cost: b.cost, end: ctx.slots[b.i + t.nSlots - 1]!.end } : null;
}

/**
 * The earliest feasible finish after the requested deadline, scanning 15-minute steps to the horizon.
 * For a task with a fixed-length successor (washer → dryer) the finish is the pair's: the option has to
 * make the whole chain fit, not just the first appliance.
 */
function earliestFeasibleFinish(t: Task, ctx: Ctx, succ?: Task): { cost: number; end: number; energy: number } | null {
  const horizonEnd = ctx.slots.at(-1)!.end;
  const tail = succ ? succ.nSlots * SLOT_MS : 0;
  for (let f = alignUp(t.finishBy + 1); f <= horizonEnd; f += SLOT_MS) {
    if (t.interruptible) {
      const info = placementInfo(t, ctx, { finishBy: f });
      if (info) return { ...info, energy: t.energy };
      continue;
    }
    // Fixed-duration tasks: the earliest finish is the earliest candidate start, not the cheapest.
    for (const c of fixedCandidates(t, ctx, { finishBy: f - tail })) {
      const end = ctx.slots[c.i + t.nSlots - 1]!.end;
      if (!succ) return { cost: c.cost, end, energy: t.energy };
      const next = fixedCandidates(succ, ctx, { earliest: end, finishBy: f })[0];
      if (next) return { cost: c.cost + next.cost, end: ctx.slots[next.i + succ.nSlots - 1]!.end, energy: t.energy + succ.energy };
    }
  }
  return null;
}

/**
 * Why a task doesn't fit, plus 2–3 concrete ways forward with their extra cost versus the cheapest
 * possible run. Relaxing the rule that actually blocks it comes first (rules are the user's call),
 * then later finish times, then a lower charge target.
 */
function conflictFor(t: Task, ctx: Ctx, maxEnergy: number, succ?: Task): Conflict {
  const startDay = toDateTime(ctx.start, ctx.tz).toISODate();
  /** "9 PM", or "7 AM tomorrow" when it falls on a later day than the request. */
  const when = (x: number) => {
    const d = toDateTime(x, ctx.tz);
    const label = speakTime(x, ctx.tz);
    if (d.toISODate() === startDay) return label;
    const nextDay = toDateTime(ctx.start, ctx.tz).plus({ days: 1 }).toISODate();
    return d.toISODate() === nextDay ? `${label} tomorrow` : `${label} on ${d.toFormat("cccc")}`;
  };
  const minPrice = Math.min(...ctx.slots.map((s) => s.price));
  const options: ConflictOption[] = [];
  const add = (label: string, cost: number | null, change: ConflictOption["change"], energy = t.energy) => {
    if (cost === null || options.length >= 3) return;
    if (options.some((o) => o.label.startsWith(label))) return;
    const extra = Math.max(0, roundCents(cost - energy * minPrice));
    options.push({ label: extra > 0 ? `${label} (+${dollars(extra)})` : label, extraCostCents: extra, change });
  };

  const quietCost = t.noisy && ctx.quietRule ? placementCost(t, ctx, { ignoreQuiet: true }) : null;
  const loadCost = ctx.maxLoad !== undefined && ctx.maxLoadRuleId ? placementCost(t, ctx, { ignoreLoad: true }) : null;
  let why = `by ${when(t.finishBy)}`;
  if (quietCost !== null) {
    const q = nextQuietStart(ctx, ctx.start);
    why = q !== undefined ? `before quiet hours start at ${when(q)}` : "outside quiet hours";
    add("Allow it during quiet hours", quietCost, { relaxRuleId: ctx.quietRule!.id });
  } else if (loadCost !== null) {
    why = `without going over the ${ctx.maxLoad} kW limit`;
    add(`Go over the ${ctx.maxLoad} kW limit briefly`, loadCost, { relaxRuleId: ctx.maxLoadRuleId! });
  }
  if (t.device.battery && t.targetPercent !== undefined && maxEnergy > 0) {
    const reachable = Math.floor((t.device.battery.socPercent + (maxEnergy / t.device.battery.capacityKwh) * 100) / 5) * 5;
    if (reachable > t.device.battery.socPercent) {
      const c = placementCost(t, ctx, { energy: ((reachable - t.device.battery.socPercent) / 100) * t.device.battery.capacityKwh });
      add(`Charge to ${reachable}% instead of ${t.targetPercent}%`, c, { targetPercent: reachable });
    }
  }
  // Later deadlines: the earliest finish that works, and the cheapest one if it's different.
  const chain = succ && !succ.interruptible && !t.interruptible ? succ : undefined;
  const earliest = earliestFeasibleFinish(t, ctx, chain);
  if (earliest && earliest.end > t.finishBy) {
    add(`Finish by ${when(earliest.end)} instead`, earliest.cost, { finishBy: iso(earliest.end, ctx.tz) }, earliest.energy);
  }
  if (!chain) {
    const cheapest = placementInfo(t, ctx, { finishBy: ctx.slots.at(-1)!.end });
    if (cheapest && earliest && cheapest.end > t.finishBy && cheapest.end !== earliest.end && cheapest.cost < earliest.cost - 0.5) {
      add(`Finish by ${when(cheapest.end)} instead`, cheapest.cost, { finishBy: iso(cheapest.end, ctx.tz) });
    }
  }
  if (loadCost !== null && quietCost !== null) {
    add(`Go over the ${ctx.maxLoad} kW limit briefly`, loadCost, { relaxRuleId: ctx.maxLoadRuleId! });
  }
  return {
    deviceId: t.device.id,
    message: t.device.battery && t.targetPercent !== undefined && why.startsWith("by ")
      ? `I can't charge the car to ${t.targetPercent}% ${why}.`
      : `I can't fit ${t.device.battery ? "charging the car" : the(t.device.name)} ${why}.`,
    options,
  };
}

// ───────────────────────── plan ─────────────────────────

/**
 * Plan flexible appliances against the tariff. Pure and deterministic.
 * Rules > presence > price: hard constraints (deadlines, quiet hours, load cap) are never traded for cents.
 */
export function plan(
  h: Household,
  tariff: NormalizedTariff,
  now: Instant,
  tasks: TaskRequest[],
  rules: Rule[] = h.rules,
  opts: PlanOptions = {},
): Plan {
  const nowMs = ms(now);
  const relaxed = new Set(opts.relaxRuleIds ?? []);
  const activeRules = rules.filter((r) => !relaxed.has(r.id));
  const start = alignUp(nowMs);
  const resolved = resolveTasks(h, start, tasks, activeRules);
  const needed = resolved.filter((t) => t.energy > EPS);

  const latest = Math.max(...needed.map((t) => (Number.isNaN(t.finishBy) ? 0 : t.finishBy)), 0);
  const end = alignUp(Math.max(latest, start + 24 * HOUR));
  for (const t of resolved) {
    if (Number.isNaN(t.finishBy)) t.finishBy = end;
    t.latestFinish = t.finishBy;
  }

  const quietRule = rulesOf(activeRules, "quiet_hours")[0];
  const loadRule = maxLoadRule(activeRules);
  const ctx: Ctx = {
    h,
    tariff,
    tz: h.timezone,
    start,
    slots: priceSlots(tariff, start, end, 15).map((s) => ({ start: ms(s.start), end: ms(s.end), price: s.centsPerKwh, period: s.periodName })),
    quiet: rulesOf(activeRules, "quiet_hours").flatMap((r) => dailyIntervals(r.start, r.end, start, end, h.timezone)),
    quietRule,
    maxLoad: loadRule?.kw,
    maxLoadRuleId: loadRule?.id,
    base: opts.baseLoadKw ?? BASE_LOAD_KW,
    load: [],
    placedEnd: new Map(),
  };
  ctx.load = ctx.slots.map(() => 0);

  tightenLatestFinish(needed, ctx);

  const byId = new Map(needed.map((t) => [t.device.id, t]));
  const placements = new Map<DeviceId, Placement>();
  const conflicts: Conflict[] = [];
  const failed = new Set<DeviceId>();

  for (const t of topoOrder(needed)) {
    if (placements.has(t.device.id) || failed.has(t.device.id)) continue;
    if (t.after && failed.has(t.after)) {
      failed.add(t.device.id);
      const upstream = conflicts.find((c) => c.deviceId === t.after);
      conflicts.push({
        deviceId: t.device.id,
        message: `${capitalize(the(t.device.name))} has to wait for ${the(byId.get(t.after)!.device.name)}.`,
        options: (upstream?.options ?? []).filter((o) => "relaxRuleId" in o.change),
      });
      continue;
    }
    const succ = t.successors.length === 1 ? byId.get(t.successors[0]!) : undefined;
    if (!t.interruptible && succ && !succ.interruptible) {
      const pair = jointPlacement(t, succ, ctx);
      if (pair) {
        commit(t, pair[0], ctx);
        placements.set(t.device.id, pair[0]);
        commit(succ, pair[1], ctx);
        placements.set(succ.device.id, pair[1]);
        continue;
      }
    }
    if (t.interruptible) {
      const { placement, maxEnergy } = interruptiblePlacement(t, ctx);
      if (placement) {
        commit(t, placement, ctx);
        placements.set(t.device.id, placement);
      } else {
        failed.add(t.device.id);
        conflicts.push(conflictFor(t, ctx, maxEnergy, succ));
      }
      continue;
    }
    const best = bestOf(fixedCandidates(t, ctx));
    if (best) {
      const p = fixedPlacement(t, best.i, best.cost);
      commit(t, p, ctx);
      placements.set(t.device.id, p);
    } else {
      failed.add(t.device.id);
      conflicts.push(conflictFor(t, ctx, 0, succ));
    }
  }

  // Steps
  const planId = opts.id ?? `plan_${nowMs.toString(36)}`;
  const steps: Omit<PlanStep, "id">[] = [];
  const taskCost = new Map<DeviceId, number>();
  for (const t of needed) {
    const p = placements.get(t.device.id);
    if (!p) continue;
    if (!t.interruptible) {
      const cost = roundCents(p.cost);
      taskCost.set(t.device.id, cost);
      steps.push({
        deviceId: t.device.id,
        action: "run",
        start: iso(ctx.slots[p.idx[0]!]!.start, ctx.tz),
        end: iso(ctx.slots[p.idx.at(-1)!]!.end, ctx.tz),
        kwh: round3(t.energy),
        costCents: cost,
        reason: fixedReason(t, p, ctx, byId, placements),
      });
      continue;
    }
    // Merge contiguous charge slots at the same power into steps.
    const runs: { start: number; end: number; kwh: number; cost: number; kw: number }[] = [];
    p.idx.forEach((k, n) => {
      const s = ctx.slots[k]!;
      const kw = p.kw[n]!;
      const kwh = kw * SLOT_H;
      const last = runs.at(-1);
      if (last && last.end === s.start && Math.abs(last.kw - kw) < 1e-6) {
        last.end = s.end;
        last.kwh += kwh;
        last.cost += kwh * s.price;
      } else runs.push({ start: s.start, end: s.end, kwh, cost: kwh * s.price, kw });
    });
    const lastEnd = runs.at(-1)!.end;
    let total = 0;
    for (const r of runs) {
      const cost = roundCents(r.cost);
      total += cost;
      steps.push({
        deviceId: t.device.id,
        action: "charge",
        start: iso(r.start, ctx.tz),
        end: iso(r.end, ctx.tz),
        kwh: round3(r.kwh),
        costCents: cost,
        reason: chargeReason(t, r, lastEnd, ctx),
      });
    }
    taskCost.set(t.device.id, total);
  }
  steps.sort((a, b) => ms(a.start) - ms(b.start) || a.deviceId.localeCompare(b.deviceId));
  const finalSteps: PlanStep[] = steps.map((s, n) => ({ id: `${planId}_s${n + 1}`, ...s }));

  const planned = needed.filter((t) => placements.has(t.device.id));
  const baseline = baselineCosts(planned, ctx);
  const costCents = finalSteps.reduce((s, x) => s + x.costCents, 0);
  const baselineCostCents = [...baseline.values()].reduce((s, x) => s + x, 0);
  const taskSavings: Record<DeviceId, number> = {};
  for (const t of planned) taskSavings[t.device.id] = (baseline.get(t.device.id) ?? 0) - (taskCost.get(t.device.id) ?? 0);

  // Rule checks
  const time = (x: number) => speakTime(x, ctx.tz);
  const ruleChecks: Plan["ruleChecks"] = [];
  for (const r of rulesOf(activeRules, "quiet_hours")) {
    const noisySteps = finalSteps.filter((s) => byId.get(s.deviceId)?.noisy);
    const ok = noisySteps.every((s) => !overlaps(ms(s.start), ms(s.end), ctx.quiet));
    const range = `${time(nextOccurrence(r.start, start - 1, ctx.tz))}–${time(nextOccurrence(r.end, start - 1, ctx.tz))}`;
    ruleChecks.push({ ruleId: r.id, ok, note: noisySteps.length ? `Nothing noisy runs ${range}.` : `No noisy appliances in this plan.` });
  }
  for (const t of needed) {
    if (!t.deadlineRule || t.finishBySource !== "rule") continue;
    const end = ctx.placedEnd.get(t.device.id);
    const ok = end !== undefined && end <= t.finishBy;
    ruleChecks.push({
      ruleId: t.deadlineRule.id,
      ok,
      note: ok
        ? `${capitalize(the(t.device.name))} ${t.targetPercent !== undefined ? `reaches ${t.targetPercent}%` : "finishes"} by ${time(end!)}, before the ${time(t.finishBy)} deadline.`
        : `${capitalize(the(t.device.name))} can't meet the ${time(t.finishBy)} deadline.`,
    });
  }
  for (const t of resolved) {
    if (t.energy <= EPS && t.device.battery) {
      ruleChecks.push({ ruleId: t.deadlineRule?.id ?? "target", ok: true, note: `${capitalize(the(t.device.name))} is already at ${t.device.battery.socPercent}%.` });
    }
  }
  if (loadRule) {
    const peak = Math.max(0, ...ctx.load.filter((x) => x > EPS)) + ctx.base;
    const ok = peak <= loadRule.kw + EPS;
    ruleChecks.push({ ruleId: loadRule.id, ok, note: `Peak planned load ${round1(peak)} kW, ${ok ? "under" : "over"} the ${loadRule.kw} kW limit.` });
  }
  const neverOff = rulesOf(activeRules, "never_off");
  if (neverOff.length) ruleChecks.push({ ruleId: neverOff[0]!.id, ok: true, note: "Never-off devices are untouched." });
  if (costCents > baselineCostCents) {
    ruleChecks.push({ ruleId: "cost", ok: true, note: `Your rules make this ${dollars(costCents - baselineCostCents)} more than running everything now.` });
  }

  return {
    id: planId,
    createdAt: iso(nowMs, ctx.tz),
    steps: finalSteps,
    costCents,
    baselineCostCents,
    savingsCents: Math.max(0, baselineCostCents - costCents),
    ruleChecks,
    conflicts,
    status: "proposed",
    taskSavings,
    tasks: resolved.map((t) => ({
      deviceId: t.device.id,
      ...(t.req.earliestStart ? { earliestStart: t.req.earliestStart } : {}),
      ...(t.finishBySource !== "horizon" ? { finishBy: iso(t.finishBy, ctx.tz) } : {}),
      ...(t.targetPercent !== undefined ? { targetPercent: t.targetPercent } : {}),
      ...(t.after ? { after: t.after } : {}),
    })),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
