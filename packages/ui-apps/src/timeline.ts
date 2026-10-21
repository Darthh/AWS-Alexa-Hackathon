/**
 * Framework-free renderer for Off-Peak tool results (plan, home status, savings).
 * Shared by the MCP App (ui://off-peak/plan.html) and the web client's native Echo Show view.
 * Renders purely from structuredContent; never uses innerHTML with data.
 */

interface PriceBlock {
  start: string;
  end: string;
  centsPerKwh: number;
  periodName: string;
}

interface TimelineData {
  timezone: string;
  from: string;
  to: string;
  now: string;
  rateName: string;
  isDemoRate: boolean;
  prices: PriceBlock[];
  quiet: { start: string; end: string }[];
  rows: { deviceId: string; name: string; deadline?: string; steps: { start: string; end: string; action: string; kwh: number; costCents: number; status: string }[] }[];
}

export interface PlanView {
  view: "plan";
  status: "proposed" | "applied" | "cancelled";
  savingsCents: number;
  costCents: number;
  baselineCostCents: number;
  ruleChecks: { ruleId: string; ok: boolean; note: string }[];
  conflicts: { deviceId: string; message: string; options: { label: string }[] }[];
  isDemoRate: boolean;
  timeline: TimelineData;
}

export interface HomeView {
  view: "home";
  mode: "home" | "away" | "sleep" | "zone";
  activeZones: string[];
  returnAt: string | null;
  priceNow: { centsPerKwh: number; periodName: string };
  nextChange: { at: string; centsPerKwh: number; periodName: string } | null;
  idleCandidates: { name: string }[];
  powerNowW: number;
  isDemoRate: boolean;
  timeline: TimelineData;
}

export interface SavingsView {
  view: "savings";
  period: "today" | "week" | "month";
  totalCents: number;
  bySource: { shift: number; idle: number; away: number };
  estimatedCents: number;
  includeEstimates: boolean;
  topWins: { label: string; cents: number; estimate: boolean }[];
  isDemoRate: boolean;
}

export type OffPeakView = PlanView | HomeView | SavingsView;

export function isOffPeakView(x: unknown): x is OffPeakView {
  const v = (x as { view?: unknown } | null)?.view;
  return v === "plan" || v === "home" || v === "savings";
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const ms = (iso: string) => Date.parse(iso);

function clock(iso: string, tz: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  if (minute === "00" && hour === "12") return period === "AM" ? "midnight" : "noon";
  return minute === "00" ? `${hour} ${period}` : `${hour}:${minute} ${period}`;
}

function range(a: string, b: string, tz: string): string {
  const x = clock(a, tz);
  const y = clock(b, tz);
  const mx = x.slice(-2);
  return (mx === "AM" || mx === "PM") && y.endsWith(mx) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`;
}

/** Compact bar label: "5:30–7 PM", "12–4:45 AM". */
function shortRange(a: string, b: string, tz: string): string {
  const fix = (x: string) => x.replace("midnight", "12 AM").replace("noon", "12 PM");
  const x = fix(clock(a, tz));
  const y = fix(clock(b, tz));
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`;
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function periodClass(name: string): string {
  if (name.includes("super")) return "p-sop";
  if (name === "peak") return "p-peak";
  if (name.includes("mid")) return "p-mid";
  return "p-op";
}

function pct(t: number, from: number, to: number): number {
  return Math.max(0, Math.min(100, ((t - from) / (to - from)) * 100));
}

function place(e: HTMLElement, a: number, b: number, from: number, to: number): HTMLElement {
  const l = pct(a, from, to);
  e.style.left = `${l}%`;
  e.style.width = `${Math.max(0.6, pct(b, from, to) - l)}%`;
  return e;
}

function nowMarker(t: TimelineData, from: number, to: number): HTMLElement {
  const m = el("div", "tl-now");
  m.style.left = `${pct(ms(t.now), from, to)}%`;
  return m;
}

/** Price strip + quiet hours + one row per device (max 5), with deadline and now markers. */
export function renderTimeline(t: TimelineData): HTMLElement {
  const from = ms(t.from);
  const to = ms(t.to);
  const wrap = el("div", "tl");

  const axis = el("div", "tl-row tl-axis");
  axis.append(el("div", "tl-label"));
  const ticks = el("div", "tl-track");
  const stepH = to - from > 30 * 3_600_000 ? 6 : 3;
  for (const p of t.prices) {
    const start = ms(p.start);
    const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: t.timezone }).format(new Date(start)));
    if (hour % stepH !== 0) continue;
    const tick = el("div", "tl-tick", clock(p.start, t.timezone).replace("midnight", "12 AM").replace("noon", "12 PM"));
    tick.style.left = `${pct(start, from, to)}%`;
    ticks.append(tick);
  }
  axis.append(ticks);
  wrap.append(axis);

  const priceRow = el("div", "tl-row tl-prices");
  priceRow.append(el("div", "tl-label", "Price"));
  const track = el("div", "tl-track");
  // One block per contiguous price period (not per 15-minute slot), so the strip has no seams.
  const blocks: { start: number; end: number; periodName: string; centsPerKwh: number }[] = [];
  for (const p of t.prices) {
    const last = blocks.at(-1);
    if (last && last.end === ms(p.start) && last.periodName === p.periodName && last.centsPerKwh === p.centsPerKwh) last.end = ms(p.end);
    else blocks.push({ start: ms(p.start), end: ms(p.end), periodName: p.periodName, centsPerKwh: p.centsPerKwh });
  }
  for (const p of blocks) {
    const b = place(el("div", `tl-price ${periodClass(p.periodName)}`), p.start, p.end, from, to);
    b.title = `${p.periodName}: ${p.centsPerKwh}¢/kWh`;
    track.append(b);
  }
  for (const q of t.quiet) track.append(place(el("div", "tl-quiet"), ms(q.start), ms(q.end), from, to));
  track.append(nowMarker(t, from, to));
  priceRow.append(track);
  wrap.append(priceRow);

  for (const row of t.rows.slice(0, 5)) {
    const r = el("div", "tl-row");
    r.append(el("div", "tl-label", row.name));
    const tr = el("div", "tl-track tl-lane");
    for (const q of t.quiet) tr.append(place(el("div", "tl-quiet tl-quiet-lane"), ms(q.start), ms(q.end), from, to));
    // Merge back-to-back steps (EV power changes) into one visual bar.
    const merged: { start: string; end: string; status: string; action: string }[] = [];
    for (const s of [...row.steps].sort((a, b) => ms(a.start) - ms(b.start))) {
      const last = merged.at(-1);
      if (last && ms(last.end) === ms(s.start)) last.end = s.end;
      else merged.push({ start: s.start, end: s.end, status: s.status, action: s.action });
    }
    for (const s of merged) {
      const a = ms(s.start);
      const b = ms(s.end);
      const bar = place(el("div", `tl-bar s-${s.status}`), a, b, from, to);
      const label = shortRange(s.start, s.end, t.timezone);
      const widthPct = pct(b, from, to) - pct(a, from, to);
      if (widthPct >= label.length * 1.75) bar.append(el("span", "tl-bar-text", label));
      else {
        const outside = el("span", "tl-bar-out", label);
        outside.style.left = `calc(${pct(b, from, to)}% + 6px)`;
        tr.append(outside);
      }
      tr.append(bar);
    }
    if (row.deadline && ms(row.deadline) <= to) {
      const d = el("div", "tl-deadline");
      d.style.left = `${pct(ms(row.deadline), from, to)}%`;
      d.append(el("span", "tl-deadline-text", `by ${clock(row.deadline, t.timezone)}`));
      tr.append(d);
    }
    tr.append(nowMarker(t, from, to));
    r.append(tr);
    wrap.append(r);
  }

  const legend = el("div", "tl-legend");
  const seen = new Map<string, number>();
  for (const p of t.prices) if (!seen.has(p.periodName)) seen.set(p.periodName, p.centsPerKwh);
  for (const [name, cents] of [...seen].sort((a, b) => a[1] - b[1])) {
    const chip = el("span", "tl-chip");
    chip.append(el("i", `tl-swatch ${periodClass(name)}`), document.createTextNode(`${name} ${Math.round(cents * 10) / 10}¢`));
    legend.append(chip);
  }
  if (t.quiet.length) {
    const chip = el("span", "tl-chip");
    chip.append(el("i", "tl-swatch tl-quiet-swatch"), document.createTextNode("quiet hours"));
    legend.append(chip);
  }
  wrap.append(legend);
  return wrap;
}

function header(title: string, badges: { text: string; cls: string }[]): HTMLElement {
  const h = el("div", "op-head");
  h.append(el("h1", "op-title", title));
  const b = el("div", "op-badges");
  for (const x of badges) b.append(el("span", `op-badge ${x.cls}`, x.text));
  h.append(b);
  return h;
}

function renderPlan(v: PlanView): HTMLElement[] {
  const badges = [{ text: v.savingsCents > 0 ? `Saves ${dollars(v.savingsCents)}` : "Already cheapest", cls: "b-save" }];
  if (v.isDemoRate) badges.push({ text: "Demo rate", cls: "b-muted" });
  const title = v.status === "applied" ? "Scheduled" : v.status === "cancelled" ? "Cancelled plan" : "Proposed plan";
  const out = [header(title, badges), renderTimeline(v.timeline)];
  const foot = el("div", "op-foot");
  for (const c of v.conflicts.slice(0, 2)) {
    const box = el("div", "op-conflict");
    box.append(el("strong", undefined, c.message));
    if (c.options.length) box.append(el("div", "op-options", c.options.map((o) => o.label).join(" · ")));
    foot.append(box);
  }
  for (const r of v.ruleChecks.filter((x) => x.ruleId !== "cost").slice(0, 3)) foot.append(el("div", `op-check ${r.ok ? "ok" : "bad"}`, `${r.ok ? "✓" : "✗"} ${r.note}`));
  out.push(foot);
  return out;
}

function modeText(v: HomeView): string {
  if (v.mode === "away") return v.returnAt ? `Away until ${clock(v.returnAt, v.timeline.timezone)}` : "Away";
  if (v.mode === "sleep") return "Sleep";
  if (v.mode === "zone") return `${v.activeZones.join(" + ")} only`;
  return "Home";
}

function renderHome(v: HomeView): HTMLElement[] {
  const price = `${v.priceNow.periodName} · ${v.priceNow.centsPerKwh}¢${v.nextChange ? ` until ${clock(v.nextChange.at, v.timeline.timezone)}` : ""}`;
  const badges = [
    { text: modeText(v), cls: "b-mode" },
    { text: price, cls: periodClass(v.priceNow.periodName) },
    { text: `${(v.powerNowW / 1000).toFixed(1)} kW now`, cls: "b-muted" },
  ];
  const out = [header("Home", badges), renderTimeline(v.timeline)];
  if (v.idleCandidates.length) out.push(el("div", "op-foot op-check", `💤 Idle on standby: ${v.idleCandidates.map((d) => d.name).join(", ")}`));
  return out;
}

function renderSavings(v: SavingsView): HTMLElement[] {
  const label = v.period === "today" ? "today" : v.period === "week" ? "this week" : "this month";
  const out: HTMLElement[] = [];
  const hero = el("div", "sv-hero");
  hero.append(el("div", "sv-total", dollars(v.totalCents)), el("div", "sv-sub", `saved ${label}${v.isDemoRate ? " · demo rate" : ""}`));
  out.push(hero);
  const max = Math.max(1, v.bySource.shift, v.bySource.idle, v.bySource.away);
  const bars = el("div", "sv-bars");
  for (const [key, name] of [["shift", "Cheaper hours"], ["idle", "Idle standby off"], ["away", "Empty rooms"]] as const) {
    const row = el("div", "sv-row");
    row.append(el("span", "sv-name", name));
    const track = el("div", "sv-track");
    const fill = el("div", `sv-fill sv-${key}`);
    fill.style.width = `${(v.bySource[key] / max) * 100}%`;
    track.append(fill);
    row.append(track, el("span", "sv-amt", dollars(v.bySource[key])));
    bars.append(row);
  }
  out.push(bars);
  if (v.topWins.length) {
    const wins = el("ul", "sv-wins");
    for (const w of v.topWins) wins.append(el("li", undefined, `${w.label} — ${dollars(w.cents)}`));
    out.push(wins);
  }
  if (!v.includeEstimates && v.estimatedCents > 0) out.push(el("div", "sv-note", `+ ${dollars(v.estimatedCents)} estimated from cooling setback and water-heater eco (not included)`));
  return out;
}

/** Replace `root`'s content with the view for a structuredContent payload. */
export function renderView(root: HTMLElement, data: unknown): void {
  root.replaceChildren();
  root.classList.add("op-view");
  if (!isOffPeakView(data)) {
    root.append(el("div", "op-empty", "Ask about tonight's plan, the price, or your savings."));
    return;
  }
  const parts = data.view === "plan" ? renderPlan(data) : data.view === "home" ? renderHome(data) : renderSavings(data);
  root.append(...parts);
}
