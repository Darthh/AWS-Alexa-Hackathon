import { useCallback, useEffect, useRef, useState } from "react";
import {
  InspectorPanel,
  ClockPanel,
  HousePanel,
  LedgerPanel,
} from "./components/Panels.tsx";
import {
  McpAppView,
  NativeView,
  type ScreenPayload,
} from "./components/Screens.tsx";
import { Conversation, type ToolEvent } from "./lib/converse.ts";
import { getConnection, type McpConn, type RpcLog } from "./lib/mcp.ts";
import { subscribe, type Snapshot } from "./lib/sim.ts";
import {
  createListener,
  speak,
  speechInputSupported,
  stopSpeaking,
  type Listener,
} from "./lib/speech.ts";
import { Icon, type IconName } from "./components/Icon.tsx";

const MCP_URL: string =
  import.meta.env.VITE_MCP_URL ??
  (import.meta.env.DEV
    ? "http://localhost:8787/mcp"
    : `${location.origin}/mcp`);
const SERVER_BASE = MCP_URL.replace(/\/mcp\/?$/, "");
const params = new URLSearchParams(location.search);

const DEMO_LINES = [
  "I need the car charged by 7, dishes and laundry done tonight, nothing loud after 10.",
  "Do it.",
  "We're heading out until 9.",
  "Why did the TV turn off?",
  "Turn it back on.",
  "How much did Off-Peak save me today?",
  "It's just me in the office.",
  "What's the price right now?",
];

interface Caption {
  who: "you" | "alexa";
  text: string;
}

interface LlmConfig {
  mode: "mock" | "bedrock";
  modelId: string | null;
  tts: "polly" | "browser";
}

type Brain = "llm" | "scripted";

export function App() {
  const [conn, setConn] = useState<McpConn | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [logs, setLogs] = useState<RpcLog[]>([]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [simOk, setSimOk] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [interim, setInterim] = useState("");
  const [payload, setPayload] = useState<ScreenPayload | null>(null);
  const [appHtml, setAppHtml] = useState<string | null>(null);
  const [useNative, setUseNative] = useState(params.get("ui") === "native");
  const [voiceOnly, setVoiceOnly] = useState(false);
  const [brain, setBrain] = useState<Brain>(
    params.get("mode") === "scripted" ? "scripted" : "llm",
  );
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [tab, setTab] = useState<"ledger" | "inspector">("ledger");
  const [text, setText] = useState("");
  const [nav, setNav] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const convo = useRef<Conversation | null>(null);
  const listener = useRef<Listener | null>(null);
  const seq = useRef(0);

  const addLog = useCallback(
    (e: RpcLog) =>
      setLogs((l) => (l.length > 400 ? [...l.slice(-300), e] : [...l, e])),
    [],
  );

  // MCP: initialize → tools/list → resources/list, then fetch the MCP App HTML.
  useEffect(() => {
    let alive = true;
    getConnection(MCP_URL, addLog)
      .then(async (c) => {
        if (!alive) return;
        setConn(c);
        const [html, result] = await Promise.all([
          c.readText("ui://off-peak/plan.html"),
          c.callTool("get_home_status", {}),
        ]);
        if (!alive) return;
        if (html && html.includes("op-view") && html.length > 5000)
          setAppHtml(html);
        // First screen: home status.
        setPayload({
          seq: ++seq.current,
          tool: "get_home_status",
          args: {},
          result,
        });
      })
      .catch((err: Error) => setConnError(err.message));
    fetch(`${SERVER_BASE}/llm/config`)
      .then((r) => r.json())
      .then((cfg: LlmConfig) => alive && setLlm(cfg))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [addLog]);

  useEffect(() => subscribe(SERVER_BASE, setSnap, setSimOk), []);

  const sawUi = useRef(false);
  const onTool = useCallback(
    (e: ToolEvent) => {
      if (conn?.uiTools.has(e.name) && !e.result.isError) {
        sawUi.current = true;
        setPayload({
          seq: ++seq.current,
          tool: e.name,
          args: e.args,
          result: e.result,
        });
      }
    },
    [conn],
  );

  /** After a turn that changed the home but returned no screen, the host refreshes the display. */
  const refreshScreen = useCallback(async () => {
    if (!conn) return;
    const result = await conn.callTool("get_home_status", {});
    if (!result.isError)
      setPayload({
        seq: ++seq.current,
        tool: "get_home_status",
        args: {},
        result,
      });
  }, [conn]);

  useEffect(() => {
    if (conn) convo.current = new Conversation(conn, SERVER_BASE, onTool);
  }, [conn, onTool]);

  const ask = useCallback(
    async (utterance: string) => {
      const u = utterance.trim();
      if (!u || !convo.current || busy) return;
      stopSpeaking();
      setBusy(true);
      setCaptions((c) => [...c.slice(-3), { who: "you", text: u }]);
      try {
        sawUi.current = false;
        const r =
          brain === "scripted"
            ? await convo.current.askScripted(u)
            : await convo.current.askLlm(u);
        setCaptions((c) => [...c.slice(-3), { who: "alexa", text: r.reply }]);
        if (!sawUi.current && r.toolCalls > 0) void refreshScreen();
        // Speaking never blocks the next turn; a new question interrupts it.
        setSpeaking(true);
        void speak(r.reply, {
          serverBase: SERVER_BASE,
          polly: llm?.tts === "polly",
          muted,
        }).finally(() => setSpeaking(false));
      } catch (err) {
        setCaptions((c) => [
          ...c.slice(-3),
          {
            who: "alexa",
            text: `Sorry, something went wrong: ${(err as Error).message}`,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [brain, busy, llm, muted, refreshScreen],
  );

  // Push-to-talk: hold the mic button or the spacebar.
  useEffect(() => {
    listener.current = createListener({
      interim: setInterim,
      final: (t) => {
        setInterim("");
        void ask(t);
      },
      end: () => setListening(false),
      error: (m) =>
        setCaptions((c) => [
          ...c.slice(-3),
          {
            who: "alexa",
            text: `Microphone error: ${m}. You can type instead.`,
          },
        ]),
    });
  }, [ask]);

  const startListening = useCallback(() => {
    if (!listener.current || listening) return;
    stopSpeaking();
    setListening(true);
    setInterim("");
    listener.current.start();
  }, [listening]);
  const stopListening = useCallback(() => listener.current?.stop(), []);

  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !typing(e)) {
        e.preventDefault();
        startListening();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e)) {
        e.preventDefault();
        stopListening();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startListening, stopListening]);

  const brainLabel =
    brain === "scripted"
      ? "Scripted (no LLM)"
      : llm?.mode === "bedrock"
        ? `Bedrock · ${llm.modelId ?? "no model set"}`
        : "Mock LLM";
  const lastAlexa = [...captions].reverse().find((c) => c.who === "alexa");
  const lastYou = [...captions].reverse().find((c) => c.who === "you");

  const navigate = (id: string) => {
    setNav(id);
    setMenuOpen(false);
    if (id === "inspector" || id === "ledger") setTab(id);
    requestAnimationFrame(() =>
      document
        .getElementById(id === "inspector" || id === "ledger" ? "activity" : id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const links: { id: string; label: string; icon: IconName }[] = [
    { id: "overview", label: "Overview", icon: "grid" },
    { id: "simulator", label: "Alexa+ simulator", icon: "mic" },
    { id: "household", label: "Household", icon: "home" },
    { id: "clock", label: "Sim clock", icon: "clock" },
    { id: "ledger", label: "Ledger & savings", icon: "chart" },
    { id: "inspector", label: "MCP Inspector", icon: "code" },
  ];

  return (
    <div className="app">
      <a className="skip-link" href="#overview">
        Skip to content
      </a>
      <header className="topbar">
        <button
          className="menu-toggle"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Icon name="menu" />
        </button>
        <a
          className="brand"
          href="#overview"
          onClick={() => navigate("overview")}
        >
          <span className="brand-mark">
            <Icon name="clock" size={24} />
          </span>
          OffPeak
          <span className="brand-divider" />{" "}
          <span className="console-label">Energy console</span>
        </a>
        <div className="topbar-right">
          <span className="top-region">
            {snap?.clock.timezone ?? "America/Los_Angeles"}
          </span>
          <a
            href="https://github.com/Darthh/AWS-Alexa-Hackathon#readme"
            target="_blank"
            rel="noreferrer"
          >
            Documentation <Icon name="external" size={13} />
          </a>
          <span className="top-demo">
            <span className="status-dot" /> Demo household
          </span>
        </div>
      </header>

      <aside
        className={`sidebar ${menuOpen ? "is-open" : ""}`}
        aria-label="Console navigation"
      >
        <div className="sidebar-title">
          <span className="service-icon">
            <Icon name="bolt" size={22} />
          </span>
          <div>
            OffPeak<strong>Home energy</strong>
          </div>
        </div>
        <nav>
          {links.map((link) => (
            <button
              key={link.id}
              className={nav === link.id ? "selected" : ""}
              aria-current={nav === link.id ? "page" : undefined}
              onClick={() => navigate(link.id)}
            >
              <Icon name={link.icon} />
              {link.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Icon name="shield" size={22} />
          <strong>Your household comes first.</strong>
          <p>
            Rules, then presence,
            <br />
            then electricity price.
          </p>
          <span className="prototype-tag">Alexa+ hackathon prototype</span>
        </div>
      </aside>

      <main className="workspace" id="overview">
        <div className="breadcrumbs">
          <span>OffPeak</span>
          <span>/</span>
          <span>Energy console</span>
          <span>/</span>
          <strong>Overview</strong>
        </div>
        <div className="page-heading">
          <div>
            <div className="eyebrow">HOME ENERGY MANAGEMENT</div>
            <h1>Less peak. More evening.</h1>
            <p>Manage your home’s energy, without changing your plans.</p>
          </div>
          <span
            className={`connection ${conn ? "ok" : connError ? "bad" : ""}`}
            title={conn?.instructions}
          >
            <span className="status-dot" />
            {conn
              ? `MCP connected · ${conn.tools.length} tools`
              : connError
                ? "MCP offline"
                : "Connecting…"}
          </span>
        </div>
        <div className="demo-notice">
          <Icon name="info" size={17} />
          <span>
            <strong>A real planner. A simulated home.</strong> Explore with demo
            devices and synthetic electricity rates. No hardware or API keys
            needed.
          </span>
        </div>
        <section className="metrics" aria-label="Household overview">
          <article>
            <span className="metric-label">
              Electricity right now <Icon name="bolt" />
            </span>
            <strong>
              {snap ? snap.price.now.centsPerKwh : "—"}
              <small> ¢/kWh</small>
            </strong>
            <span className="metric-detail">
              <span className="orange-dot" />
              {snap ? `${snap.price.now.periodName} rate` : "Loading tariff"}
            </span>
          </article>
          <article>
            <span className="metric-label">
              Home consumption <Icon name="home" />
            </span>
            <strong>
              {snap ? (snap.powerW / 1000).toFixed(2) : "—"}
              <small> kW</small>
            </strong>
            <span className="metric-detail">Live simulated power</span>
          </article>
          <article>
            <span className="metric-label">
              Saved today <Icon name="chart" />
            </span>
            <strong className="metric-saving">
              {snap ? `$${(snap.savings.totalCents / 100).toFixed(2)}` : "—"}
            </strong>
            <span className="metric-detail">Based on synthetic demo rates</span>
          </article>
          <article>
            <span className="metric-label">
              Connected devices <Icon name="plug" />
            </span>
            <strong>
              {snap?.household.devices.length ?? "—"}
              <small> devices</small>
            </strong>
            <span className="metric-detail">
              {snap
                ? `${snap.household.zones.filter((z) => !z.shared).length} rooms · ${snap.household.devices.filter((d) => d.flags.neverOff).length} protected devices`
                : "Loading household"}
            </span>
          </article>
        </section>

        <div className="layout">
          <section className="left">
            <section
              className="panel simulator-panel"
              id="simulator"
              aria-label="Alexa+ simulator"
            >
              <header className="panel-head">
                <div>
                  <h2>
                    <Icon name="mic" />
                    Alexa+ simulator
                  </h2>
                  <p>Your evening, on your terms.</p>
                </div>
                <span className="subtle-label">
                  {voiceOnly ? "VOICE ONLY" : "ECHO SHOW"}
                </span>
              </header>
              <div className="simulator-controls">
                <button
                  className="btn small"
                  onClick={() => setBrain(brain === "llm" ? "scripted" : "llm")}
                  title="Switch between the LLM loop and the deterministic scripted router"
                >
                  Brain: {brainLabel}
                </button>
                <button
                  className={`btn small ${voiceOnly ? "active" : ""}`}
                  aria-pressed={voiceOnly}
                  onClick={() => setVoiceOnly(!voiceOnly)}
                >
                  <Icon name="screen" size={14} />
                  {voiceOnly ? "Voice-only (Echo Dot)" : "Echo Show"}
                </button>
                <button
                  className="btn small"
                  onClick={() => setUseNative(!useNative)}
                  title="MCP App iframe vs. native React rendering of the same structuredContent"
                >
                  Screen: {useNative || !appHtml ? "native" : "MCP App"}
                </button>
                <button
                  className="btn small"
                  aria-pressed={muted}
                  onClick={() => setMuted(!muted)}
                >
                  <Icon name={muted ? "mute" : "volume"} size={14} />
                  {muted ? "Muted" : "Voice"}
                </button>
              </div>
              <div className={`device ${voiceOnly ? "dot" : "show"}`}>
                {voiceOnly ? (
                  <div className="dot-wrap">
                    <div
                      className={`dot-ring ${listening ? "listening" : speaking || busy ? "speaking" : ""}`}
                    />
                  </div>
                ) : (
                  <div className="screen">
                    <div className="screen-status">
                      <span>{snap?.clock.label ?? ""}</span>
                      <span>
                        <span className="status-dot" /> OffPeak
                      </span>
                    </div>
                    <div className="screen-body">
                      {conn && appHtml && !useNative ? (
                        <McpAppView
                          html={appHtml}
                          conn={conn}
                          payload={payload}
                          onFail={() => setUseNative(true)}
                        />
                      ) : (
                        <NativeView payload={payload} />
                      )}
                    </div>
                    {(listening || busy) && (
                      <div
                        className={`screen-bar ${listening ? "listening" : "thinking"}`}
                      />
                    )}
                  </div>
                )}
                <div className="captions" aria-live="polite">
                  {!lastYou && !lastAlexa && (
                    <div className="conversation-welcome">
                      <Icon name="mic" />
                      <span>
                        <strong>What does your evening look like?</strong>
                        <br />
                        Ask Alexa to make a plan, or try a prompt below.
                      </span>
                    </div>
                  )}
                  {listening || interim ? (
                    <p className="cap you">{interim || "Listening…"}</p>
                  ) : (
                    lastYou && <p className="cap you">“{lastYou.text}”</p>
                  )}
                  {lastAlexa && <p className="cap alexa">{lastAlexa.text}</p>}
                  {busy && !listening && <p className="cap thinking">…</p>}
                </div>
              </div>

              <form
                className="ask"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(text);
                  setText("");
                }}
              >
                <button
                  type="button"
                  className={`mic ${listening ? "on" : ""}`}
                  disabled={!speechInputSupported()}
                  onMouseDown={startListening}
                  onMouseUp={stopListening}
                  onMouseLeave={() => listening && stopListening()}
                  onTouchStart={startListening}
                  onTouchEnd={stopListening}
                  title={
                    speechInputSupported()
                      ? "Hold to talk (or hold the spacebar)"
                      : "Speech input isn't supported in this browser; type instead"
                  }
                  aria-label="Hold to talk"
                >
                  <Icon name="mic" />
                </button>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Ask Alexa to plan your evening…"
                  aria-label="Message to Alexa"
                />
                <button
                  className="btn primary"
                  type="submit"
                  disabled={busy || !conn}
                >
                  Send <Icon name="arrow" size={16} />
                </button>
              </form>
              <div className="quick-actions">
                <div className="quick-heading">
                  <h3>Try a conversation</h3>
                  <span>Real MCP tool calls</span>
                </div>
                <div className="chips">
                  {DEMO_LINES.map((l) => (
                    <button
                      key={l}
                      className="chip"
                      disabled={busy || !conn}
                      onClick={() => void ask(l)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {connError && (
                <p className="error">
                  Can't reach the MCP server at {MCP_URL}: {connError}. Is `npm
                  run dev` running?
                </p>
              )}
            </section>
            <div id="clock">
              {snap && <ClockPanel snap={snap} base={SERVER_BASE} />}
            </div>
          </section>

          <section className="right">
            {snap ? (
              <div id="household">
                <HousePanel snap={snap} base={SERVER_BASE} />
              </div>
            ) : (
              <section className="panel">
                <p className="muted">
                  {simOk
                    ? "Loading the house…"
                    : "Waiting for the simulator (SIM_ADMIN=1)…"}
                </p>
              </section>
            )}
          </section>
          <section className="panel tabs" id="activity">
            <div className="tab-bar" role="tablist">
              <button
                role="tab"
                id="ledger-tab"
                aria-controls="activity-panel"
                aria-selected={tab === "ledger"}
                className={tab === "ledger" ? "active" : ""}
                onClick={() => setTab("ledger")}
              >
                Ledger & savings
              </button>
              <button
                role="tab"
                id="inspector-tab"
                aria-controls="activity-panel"
                aria-selected={tab === "inspector"}
                className={tab === "inspector" ? "active" : ""}
                onClick={() => setTab("inspector")}
              >
                MCP Inspector ({logs.length})
              </button>
            </div>
            <div
              role="tabpanel"
              id="activity-panel"
              aria-labelledby={`${tab}-tab`}
            >
              {tab === "ledger" ? (
                snap ? (
                  <LedgerPanel snap={snap} />
                ) : null
              ) : (
                <InspectorPanel
                  logs={logs}
                  protocolVersion={conn?.protocolVersion}
                  server={
                    conn?.server
                      ? `${conn.server.name} ${conn.server.version}`
                      : ""
                  }
                />
              )}
            </div>
          </section>
        </div>
        <footer className="console-footer">
          <span>
            <Icon name="clock" size={14} /> OffPeak <span>·</span> Built for the
            Alexa+ hackathon
          </span>
          <span>Household rules → presence → electricity price</span>
        </footer>
      </main>
    </div>
  );
}
