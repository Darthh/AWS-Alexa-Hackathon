import type { RpcLog, McpConn } from "../lib/mcp.ts";
import type { Snapshot } from "../lib/sim.ts";
import { Icon } from "./Icon.tsx";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export const TOUR = [
  {
    title: "Plan the evening",
    detail:
      "Ask for clean dishes, finished laundry, and a charged car. OffPeak proposes a plan; it does not run it yet.",
    action: "1. Propose a plan",
    utterance:
      "I need the car charged by 7, dishes and laundry done tonight, nothing loud after 10.",
  },
  {
    title: "Approve the plan",
    detail:
      "Compare the task costs and rule checks below. This step is your explicit approval to schedule the simulated appliances.",
    action: "2. Approve and schedule",
    utterance: "Do it.",
  },
  {
    title: "Leave home",
    detail:
      "Jump to 6:45 PM and leave until 9. Watch standby devices turn off while the washer and protected devices stay on.",
    action: "3. Leave until 9 PM",
    jump: "18:45",
    utterance: "We're heading out until 9.",
  },
  {
    title: "Ask why",
    detail:
      "Trust needs a reason. Inspect the recorded explanation for the TV action.",
    action: "4. Explain the TV action",
    utterance: "Why did the TV turn off?",
  },
  {
    title: "Undo the action",
    detail:
      "Restore the TV to its recorded previous state without undoing the rest of the household plan.",
    action: "5. Restore the TV",
    utterance: "Turn it back on.",
  },
  {
    title: "See the result",
    detail:
      "Jump to 7 AM. The EV reaches 80%; ask for the week total to include both sides of midnight.",
    action: "6. Finish the night",
    jump: "07:00",
    utterance: "How much did Off-Peak save me this week?",
  },
  {
    title: "See one-room mode",
    detail:
      "Jump to the next evening and keep only the office active. Try Large screen or Voice-only in the simulator toolbar.",
    action: "7. Use only the office",
    jump: "17:30",
    utterance: "It's just me in the office.",
  },
] as const;

function observed(logs: RpcLog[], method: string) {
  return logs.some((l) => l.dir === "in" && l.method === method && !l.error);
}

export function DemoGuide({
  step,
  running,
  error,
  ready,
  logs,
  onStart,
  onNext,
  onProof,
  onExport,
}: {
  step: number | null;
  running: boolean;
  error: string | null;
  ready: boolean;
  logs: RpcLog[];
  onStart: () => void;
  onNext: () => void;
  onProof: () => void;
  onExport: () => void;
}) {
  const scene = step === null ? null : TOUR[step];
  return (
    <section className="panel demo-guide" aria-label="Guided judge walkthrough">
      <div className="guide-main">
        <span className="guide-icon">
          <Icon name="bolt" size={23} />
        </span>
        <div>
          <div className="guide-eyebrow">
            INTERACTIVE WALKTHROUGH · REAL MCP CALLS
          </div>
          <h2>
            {step === null
              ? "An evening you can inspect, step by step."
              : scene
                ? scene.title
                : "The evening is complete. Keep the evidence."}
          </h2>
          <p>
            {step === null
              ? "Plan, approve, leave, explain, undo, and compare the result. Starting resets this browser’s demo household."
              : (scene?.detail ??
                "Inspect the protocol traffic or download your demo receipt. Costs are modeled from synthetic rates, not a measured utility bill.")}
          </p>
        </div>
      </div>
      <div className="guide-actions">
        {step === null ? (
          <button
            className="btn primary"
            disabled={!ready || running}
            onClick={onStart}
          >
            Start guided demo <Icon name="arrow" size={15} />
          </button>
        ) : (
          <>
            {scene && (
              <button
                className="btn primary"
                disabled={running || !ready}
                onClick={onNext}
              >
                {running ? "Working…" : scene.action}
                <Icon name="arrow" size={15} />
              </button>
            )}
            {!scene && (
              <button
                className="btn primary"
                disabled={running || !ready}
                onClick={onExport}
              >
                Download demo receipt
              </button>
            )}
            <button
              className="btn small ghost"
              disabled={running || !ready}
              onClick={onStart}
            >
              Restart demo
            </button>
          </>
        )}
      </div>
      {step !== null && (
        <div className="guide-progress" aria-label="Walkthrough progress">
          {TOUR.map((s, i) => (
            <span
              key={s.title}
              className={i < step ? "done" : i === step ? "current" : ""}
            >
              {i < step ? <Icon name="check" size={12} /> : i + 1}
              <span>{s.title}</span>
            </span>
          ))}
        </div>
      )}
      {error && (
        <p className="guide-error" role="alert">
          {error}
        </p>
      )}
      <div className="guide-evidence">
        <span>Protocol evidence</span>
        {["initialize", "tools/list", "tools/call"].map((method) => (
          <span
            key={method}
            className={observed(logs, method) ? "verified" : "pending"}
          >
            <Icon name={observed(logs, method) ? "check" : "clock"} size={12} />
            {method}
          </span>
        ))}
        <button onClick={onProof}>
          Inspect traffic <Icon name="arrow" size={12} />
        </button>
      </div>
    </section>
  );
}

export function PlanReview({
  snap,
  busy,
  onApprove,
  onReplan,
}: {
  snap: Snapshot;
  busy: boolean;
  onApprove: () => void;
  onReplan: () => void;
}) {
  const p = snap.plan;
  if (!p) return null;
  const stale =
    Date.parse(snap.clock.now) -
      Math.min(...p.steps.map((s) => Date.parse(s.start))) >
    60_000;
  const conflicts = p.conflicts.length > 0 || p.ruleChecks.some((r) => !r.ok);
  const blocked = stale || conflicts || p.status !== "proposed";
  return (
    <section
      className="panel plan-review"
      aria-label="Plan cost and guardrails"
    >
      <header className="panel-head">
        <h2>
          <Icon name="chart" />
          Your plan, in dollars
        </h2>
        <span
          className={`mode-chip ${p.status === "proposed" ? "mode-away" : ""}`}
        >
          {p.status}
        </span>
      </header>
      <div className="plan-costs">
        <div>
          <span>Run-now baseline</span>
          <strong>{money(p.baselineCostCents)}</strong>
        </div>
        <div>
          <span>Proposed task cost</span>
          <strong>{money(p.costCents)}</strong>
        </div>
        <div>
          <span>Modeled difference</span>
          <strong className="cost-saving">{money(p.savingsCents)}</strong>
        </div>
      </div>
      <p className="cost-scope">
        {snap.tariff.isDemoRate
          ? "Synthetic demo rate"
          : "Bundled tariff snapshot"}{" "}
        · Appliance energy costs only. Estimates exclude fixed charges and other
        utility-bill components.
      </p>
      <ul className="plan-checks">
        {p.ruleChecks.map((r, i) => (
          <li key={`${r.ruleId}-${i}`} className={r.ok ? "ok" : "bad"}>
            <Icon name={r.ok ? "check" : "info"} size={14} />
            {r.note}
          </li>
        ))}
      </ul>
      {p.conflicts.map((c, i) => (
        <div className="plan-conflict" key={i}>
          <strong>{c.message}</strong>
          <ul>
            {c.options.map((o) => (
              <li key={o.label}>{o.label}</li>
            ))}
          </ul>
        </div>
      ))}
      {p.status === "proposed" && (
        <div className="plan-approval">
          {blocked ? (
            <>
              <p>
                {stale
                  ? "The clock has moved beyond this proposal. Make a fresh plan before scheduling."
                  : "This plan has a conflict. Revise the request before scheduling."}
              </p>
              <button className="btn" disabled={busy} onClick={onReplan}>
                Make a fresh evening plan
              </button>
            </>
          ) : (
            <>
              <span>
                <Icon name="shield" size={14} />
                Nothing runs until you approve.
              </span>
              <button
                className="btn primary"
                disabled={busy}
                onClick={onApprove}
              >
                Approve this plan
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function HouseholdRules({ snap }: { snap: Snapshot }) {
  return (
    <section className="panel household-rules" aria-label="Household rules">
      <header className="panel-head">
        <h2>
          <Icon name="shield" />
          Household rules
        </h2>
        <span className="subtle-label">SERVER ENFORCED</span>
      </header>
      <ul>
        {snap.household.rules.map((r) => (
          <li key={r.id}>
            <Icon name={r.type === "never_off" ? "lock" : "check"} size={14} />
            <span>{r.summary}</span>
          </li>
        ))}
      </ul>
      <p>
        Rules come before presence and price. Ask Alexa to explain or change a
        rule.
      </p>
    </section>
  );
}

/** Export observations, not captions, personal requests, or raw RPC payloads. */
export function downloadReceipt(snap: Snapshot, conn: McpConn, logs: RpcLog[]) {
  const p = snap.plan;
  const receipt = {
    schema: "offpeak-demo-receipt/v1",
    capturedAt: new Date().toISOString(),
    simulation: true,
    measuredUtilitySavings: false,
    clock: snap.clock,
    tariff: snap.tariff,
    protocol: {
      version: conn.protocolVersion,
      transport: "Streamable HTTP",
      toolCount: conn.tools.length,
      observed: Object.fromEntries(
        ["initialize", "tools/list", "tools/call"].map((m) => [
          m,
          observed(logs, m),
        ]),
      ),
    },
    plan: p
      ? {
          status: p.status,
          baselineCostCents: p.baselineCostCents,
          costCents: p.costCents,
          projectedSavingsCents: p.savingsCents,
          conflicts: p.conflicts,
          ruleChecks: p.ruleChecks,
        }
      : null,
    realizedDemoSavings: snap.savings,
    devices: {
      total: snap.household.devices.length,
      protected: snap.household.devices
        .filter((d) => d.flags.neverOff)
        .map((d) => ({ name: d.name, on: d.state.on })),
      evChargePercent: snap.household.devices.find(
        (d) => d.kind === "ev_charger",
      )?.battery?.socPercent,
    },
    scope:
      "Task energy costs and simulated device actions. Not a measured utility bill, annual forecast, or proof of real Alexa/AWS/device integration.",
    traffic: logs.map((l) => ({
      direction: l.dir,
      method: l.method,
      latencyMs: l.latencyMs,
      bytes: l.bytes,
      error: Boolean(l.error),
    })),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "offpeak-demo-receipt.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
