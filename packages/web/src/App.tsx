import { useCallback, useEffect, useRef, useState } from "react";
import { InspectorPanel, ClockPanel, HousePanel, LedgerPanel } from "./components/Panels.tsx";
import { McpAppView, NativeView, type ScreenPayload } from "./components/Screens.tsx";
import { Conversation, type ToolEvent } from "./lib/converse.ts";
import { getConnection, type McpConn, type RpcLog } from "./lib/mcp.ts";
import { subscribe, type Snapshot } from "./lib/sim.ts";
import { createListener, speak, speechInputSupported, stopSpeaking, type Listener } from "./lib/speech.ts";

const MCP_URL: string = import.meta.env.VITE_MCP_URL ?? "http://localhost:8787/mcp";
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
  const [brain, setBrain] = useState<Brain>(params.get("mode") === "scripted" ? "scripted" : "llm");
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [tab, setTab] = useState<"ledger" | "inspector">("ledger");
  const [text, setText] = useState("");
  const convo = useRef<Conversation | null>(null);
  const listener = useRef<Listener | null>(null);
  const seq = useRef(0);

  const addLog = useCallback((e: RpcLog) => setLogs((l) => (l.length > 400 ? [...l.slice(-300), e] : [...l, e])), []);

  // MCP: initialize → tools/list → resources/list, then fetch the MCP App HTML.
  useEffect(() => {
    let alive = true;
    getConnection(MCP_URL, addLog)
      .then(async (c) => {
        if (!alive) return;
        setConn(c);
        const [html, result] = await Promise.all([c.readText("ui://off-peak/plan.html"), c.callTool("get_home_status", {})]);
        if (!alive) return;
        if (html && html.includes("op-view") && html.length > 5000) setAppHtml(html);
        // First screen: home status.
        setPayload({ seq: ++seq.current, tool: "get_home_status", args: {}, result });
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
        setPayload({ seq: ++seq.current, tool: e.name, args: e.args, result: e.result });
      }
    },
    [conn],
  );

  /** After a turn that changed the home but returned no screen, the host refreshes the display. */
  const refreshScreen = useCallback(async () => {
    if (!conn) return;
    const result = await conn.callTool("get_home_status", {});
    if (!result.isError) setPayload({ seq: ++seq.current, tool: "get_home_status", args: {}, result });
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
        const r = brain === "scripted" ? await convo.current.askScripted(u) : await convo.current.askLlm(u);
        setCaptions((c) => [...c.slice(-3), { who: "alexa", text: r.reply }]);
        if (!sawUi.current && r.toolCalls > 0) void refreshScreen();
        // Speaking never blocks the next turn; a new question interrupts it.
        setSpeaking(true);
        void speak(r.reply, { serverBase: SERVER_BASE, polly: llm?.tts === "polly", muted }).finally(() => setSpeaking(false));
      } catch (err) {
        setCaptions((c) => [...c.slice(-3), { who: "alexa", text: `Sorry, something went wrong: ${(err as Error).message}` }]);
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
      error: (m) => setCaptions((c) => [...c.slice(-3), { who: "alexa", text: `Microphone error: ${m}. You can type instead.` }]),
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
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
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
    brain === "scripted" ? "Scripted (no LLM)" : llm?.mode === "bedrock" ? `Bedrock · ${llm.modelId ?? "no model set"}` : "Mock LLM";
  const lastAlexa = [...captions].reverse().find((c) => c.who === "alexa");
  const lastYou = [...captions].reverse().find((c) => c.who === "you");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="ring-dot" /> Alexa+ simulator <span className="muted">· Off-Peak add-on</span>
        </div>
        <div className="topbar-right">
          <span className={`pill ${conn ? "ok" : connError ? "bad" : ""}`} title={conn?.instructions}>
            {conn ? `MCP ${conn.protocolVersion} · Streamable HTTP · ${conn.tools.length} tools` : connError ? "MCP offline" : "Connecting…"}
          </span>
          <button className="btn small" onClick={() => setBrain(brain === "llm" ? "scripted" : "llm")} title="Switch between the LLM loop and the deterministic scripted router">
            Brain: {brainLabel}
          </button>
          <button className={`btn small ${voiceOnly ? "active" : ""}`} onClick={() => setVoiceOnly(!voiceOnly)}>
            {voiceOnly ? "Voice-only (Echo Dot)" : "Echo Show"}
          </button>
          <button className="btn small" onClick={() => setUseNative(!useNative)} title="MCP App iframe vs. native React rendering of the same structuredContent">
            Screen: {useNative || !appHtml ? "native" : "MCP App"}
          </button>
          <button className="btn small" onClick={() => setMuted(!muted)}>
            {muted ? "🔇 Muted" : "🔊 Voice"}
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="left">
          <div className={`device ${voiceOnly ? "dot" : "show"}`}>
            {voiceOnly ? (
              <div className="dot-wrap">
                <div className={`dot-ring ${listening ? "listening" : speaking || busy ? "speaking" : ""}`} />
              </div>
            ) : (
              <div className="screen">
                <div className="screen-status">
                  <span>{snap?.clock.label ?? ""}</span>
                  <span>Off-Peak</span>
                </div>
                <div className="screen-body">
                  {conn && appHtml && !useNative ? (
                    <McpAppView html={appHtml} conn={conn} payload={payload} onFail={() => setUseNative(true)} />
                  ) : (
                    <NativeView payload={payload} />
                  )}
                </div>
                {(listening || busy) && <div className={`screen-bar ${listening ? "listening" : "thinking"}`} />}
              </div>
            )}
            <div className="captions" aria-live="polite">
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
              title={speechInputSupported() ? "Hold to talk (or hold the spacebar)" : "Speech input isn't supported in this browser; type instead"}
            >
              🎙
            </button>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say or type to Alexa… (hold space to talk)" aria-label="Message to Alexa" />
            <button className="btn" type="submit" disabled={busy || !conn}>
              Send
            </button>
          </form>
          <div className="chips">
            {DEMO_LINES.map((l) => (
              <button key={l} className="chip" disabled={busy || !conn} onClick={() => void ask(l)}>
                {l}
              </button>
            ))}
          </div>
          {connError && <p className="error">Can't reach the MCP server at {MCP_URL}: {connError}. Is `npm run dev` running?</p>}
        </section>

        <section className="right">
          {snap ? (
            <>
              <HousePanel snap={snap} base={SERVER_BASE} />
              <ClockPanel snap={snap} base={SERVER_BASE} />
            </>
          ) : (
            <section className="panel">
              <p className="muted">{simOk ? "Loading the house…" : "Waiting for the simulator (SIM_ADMIN=1)…"}</p>
            </section>
          )}
          <section className="panel tabs">
            <div className="tab-bar" role="tablist">
              <button role="tab" aria-selected={tab === "ledger"} className={tab === "ledger" ? "active" : ""} onClick={() => setTab("ledger")}>
                Ledger & savings
              </button>
              <button role="tab" aria-selected={tab === "inspector"} className={tab === "inspector" ? "active" : ""} onClick={() => setTab("inspector")}>
                MCP Inspector ({logs.length})
              </button>
            </div>
            {tab === "ledger" ? (
              snap ? <LedgerPanel snap={snap} /> : null
            ) : (
              <InspectorPanel logs={logs} protocolVersion={conn?.protocolVersion} server={conn?.server ? `${conn.server.name} ${conn.server.version}` : ""} />
            )}
          </section>
        </section>
      </main>
    </div>
  );
}
