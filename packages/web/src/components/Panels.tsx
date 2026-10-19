import { periodClass } from "@off-peak/ui-apps/timeline";
import { Fragment, useMemo, useState } from "react";
import type { RpcLog } from "../lib/mcp.ts";
import { sim, type Snapshot } from "../lib/sim.ts";
import { Icon, type IconName } from "./Icon.tsx";

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

function localTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(iso));
}

const KIND_ICON: Record<string, IconName> = {
  ev_charger: "car",
  washer: "washer",
  dryer: "washer",
  dishwasher: "washer",
  fridge: "plug",
  light: "bulb",
  plug: "plug",
  tv: "screen",
  console: "screen",
  speaker: "volume",
  pc: "screen",
  printer: "plug",
  fan: "plug",
  thermostat: "home",
  water_heater: "plug",
  router: "code",
  aquarium: "plug",
};

export function HousePanel({ snap, base }: { snap: Snapshot; base: string }) {
  const h = snap.household;
  return (
    <section className="panel house" aria-label="House">
      <header className="panel-head">
        <h2>
          <Icon name="home" />
          House
        </h2>
        <span className={`mode-chip mode-${h.mode}`}>
          {h.mode === "zone" ? `${h.activeZones.join(", ")} only` : h.mode}
          {h.returnAt
            ? ` · back ${localTime(h.returnAt, snap.clock.timezone)}`
            : ""}
        </span>
        <span className="watts">{(snap.powerW / 1000).toFixed(2)} kW</span>
      </header>
      <div className="zones">
        {h.zones.map((z) => (
          <div key={z.id} className={`zone ${z.occupied ? "occupied" : ""}`}>
            <div className="zone-head">
              <strong>{z.name}</strong>
              {!z.shared && (
                <label
                  className="people"
                  title="People here (simulated motion)"
                >
                  <input
                    type="checkbox"
                    checked={z.present}
                    onChange={(e) =>
                      void sim.motion(base, z.id, e.target.checked)
                    }
                  />
                  <span>
                    {z.present
                      ? "people here"
                      : z.idleMinutes !== null
                        ? `empty ${z.idleMinutes}m`
                        : "empty"}
                  </span>
                </label>
              )}
            </div>
            <ul>
              {h.devices
                .filter((d) => d.zoneId === z.id)
                .map((d) => (
                  <li
                    key={d.id}
                    className={`dev ${d.state.on ? "on" : "off"} ${d.state.running ? "running" : ""}`}
                  >
                    <span className="dev-icon" aria-hidden>
                      <Icon name={KIND_ICON[d.kind] ?? "plug"} size={14} />
                    </span>
                    <span className="dev-name">{d.name}</span>
                    <span className="dev-badges">
                      {d.flags.neverOff && (
                        <b title="Never off">
                          <Icon name="lock" size={11} />
                        </b>
                      )}
                      {d.flags.askFirst && <b title="Ask first">✋</b>}
                      {d.flags.scheduled && <b title="Scheduled">⏰</b>}
                      {d.flags.standby && <b title="Standby">💤</b>}
                      {d.battery && (
                        <b className="soc">
                          {Math.round(d.battery.socPercent)}%
                        </b>
                      )}
                      {d.state.setpointF !== undefined && (
                        <b>{d.state.setpointF}°F</b>
                      )}
                      {d.kind === "water_heater" && d.state.ecoMode && (
                        <b>eco</b>
                      )}
                    </span>
                    <span className="dev-w">
                      {d.state.on ? `${d.state.powerW} W` : "off"}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const JUMPS: [string, string][] = [
  ["5:30 PM", "17:30"],
  ["6:45 PM", "18:45"],
  ["9 PM", "21:00"],
  ["Midnight", "00:00"],
  ["7 AM", "07:00"],
];

export function ClockPanel({ snap, base }: { snap: Snapshot; base: string }) {
  const c = snap.clock;
  const nowMs = Date.parse(c.now);
  const first = Date.parse(snap.strip[0]?.start ?? c.now);
  const last = Date.parse(snap.strip.at(-1)?.end ?? c.now);
  const nowPct = Math.max(
    0,
    Math.min(100, ((nowMs - first) / (last - first)) * 100),
  );
  const isSim = c.kind === "sim";
  return (
    <section className="panel clock" aria-label="Simulated clock">
      <header className="panel-head">
        <h2>
          <Icon name="clock" size={16} />
          Sim clock
        </h2>
        <span className="clock-time">{c.label}</span>
        {isSim && (
          <button
            className="btn"
            onClick={() => void sim.clock(base, c.playing ? "pause" : "play")}
          >
            {c.playing ? "⏸ Pause" : "▶ Play"}
          </button>
        )}
      </header>
      {isSim && (
        <div className="row wrap">
          {[1, 60, 600].map((s) => (
            <button
              key={s}
              className={`btn small ${c.speed === s ? "active" : ""}`}
              onClick={() => void sim.clock(base, "speed", s)}
            >
              {s}×
            </button>
          ))}
          <span className="sep" />
          {JUMPS.map(([label, v]) => (
            <button
              key={v}
              className="btn small"
              onClick={() => void sim.clock(base, "set", v)}
              title={`Jump forward to the next ${label}`}
            >
              → {label}
            </button>
          ))}
          <button
            className="btn small ghost"
            onClick={() => void sim.reset(base)}
            title="Reset the house and clock"
          >
            Reset
          </button>
        </div>
      )}
      <div className="strip" role="img" aria-label={snap.tariff.today}>
        {snap.strip.map((s) => (
          <div
            key={s.start}
            className={`strip-cell ${periodClass(s.periodName)}`}
            title={`${localTime(s.start, c.timezone)} ${s.periodName} ${s.centsPerKwh}¢`}
          />
        ))}
        <div className="strip-now" style={{ left: `${nowPct}%` }} />
      </div>
      <div className="strip-labels">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>noon</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
      <p className="muted">
        <strong
          className={`price-now ${periodClass(snap.price.now.periodName)}`}
        >
          <span className="cap-first">{snap.price.now.periodName}</span>{" "}
          {snap.price.now.centsPerKwh}¢/kWh
        </strong>{" "}
        · {snap.tariff.today} ·{" "}
        {snap.tariff.isDemoRate
          ? "Demo rate (synthetic)"
          : `${snap.tariff.utility} ${snap.tariff.name}`}
      </p>
    </section>
  );
}

export function LedgerPanel({ snap }: { snap: Snapshot }) {
  const name = (id?: string) =>
    snap.household.devices.find((d) => d.id === id)?.name ?? "";
  const s = snap.savings;
  return (
    <div className="ledger">
      <div className="savings">
        <div className="savings-total">{dollars(s.totalCents)}</div>
        <div className="muted">
          saved today · shift {dollars(s.bySource.shift)} · idle{" "}
          {dollars(s.bySource.idle)} · rooms {dollars(s.bySource.away)}
          {s.estimatedCents > 0 ? ` · +${dollars(s.estimatedCents)} est.` : ""}
        </div>
      </div>
      <ol className="ledger-list">
        {snap.ledger.length === 0 && (
          <li className="muted">Nothing yet. Ask Alexa to plan tonight.</li>
        )}
        {snap.ledger.map((e) => (
          <li
            key={e.id}
            className={`ledger-row src-${e.source} ${e.undone ? "undone" : ""}`}
          >
            <span className="l-time">
              {localTime(e.at, snap.clock.timezone)}
            </span>
            <span className="l-what">
              <strong>
                {e.deviceId ? `${name(e.deviceId)} · ${e.action}` : e.action}
              </strong>
              <span className="l-why">{e.reason}</span>
            </span>
            <span className="l-save">
              {e.liveSavedCents > 0
                ? `${dollars(e.liveSavedCents)}${e.estimate ? "*" : ""}`
                : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function InspectorPanel({
  logs,
  protocolVersion,
  server,
}: {
  logs: RpcLog[];
  protocolVersion?: string;
  server?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [hideNoise, setHideNoise] = useState(true);
  const rows = useMemo(
    () =>
      hideNoise
        ? logs.filter(
            (l) =>
              !l.method.startsWith("notifications/") && l.method !== "ping",
          )
        : logs,
    [logs, hideNoise],
  );
  return (
    <div className="inspector">
      <div className="row wrap">
        <span className="mcp-badge">
          MCP {protocolVersion ?? "…"} · Streamable HTTP
        </span>
        <span className="muted">{server}</span>
        <label className="muted">
          <input
            type="checkbox"
            checked={hideNoise}
            onChange={(e) => setHideNoise(e.target.checked)}
          />{" "}
          hide notifications
        </label>
      </div>
      <table className="rpc">
        <thead>
          <tr>
            <th />
            <th>method</th>
            <th>id</th>
            <th>ms</th>
            <th>size</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((l) => (
            <Fragment key={l.seq}>
              <tr
                className={`rpc-row ${l.dir} ${l.error ? "err" : ""} ${l.method === "tools/call" ? "call" : ""}`}
                onClick={() => setOpen(open === l.seq ? null : l.seq)}
              >
                <td>{l.dir === "out" ? "→" : "←"}</td>
                <td>
                  {l.method}
                  {l.method === "tools/call" && l.dir === "out"
                    ? ` ${(l.payload as { params?: { name?: string } }).params?.name ?? ""}`
                    : ""}
                </td>
                <td>{l.id ?? ""}</td>
                <td>{l.latencyMs ?? ""}</td>
                <td>
                  {l.bytes < 1024
                    ? `${l.bytes} B`
                    : `${(l.bytes / 1024).toFixed(1)} KB`}
                </td>
              </tr>
              {open === l.seq && (
                <tr className="rpc-payload">
                  <td colSpan={5}>
                    <pre>
                      {JSON.stringify(l.payload, null, 2).slice(0, 6000)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
