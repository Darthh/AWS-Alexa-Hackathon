import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "@off-peak/ui-apps/timeline.css";
import { renderView } from "@off-peak/ui-apps/timeline";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { McpConn } from "../lib/mcp.ts";

export interface ScreenPayload {
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  result: CallToolResult;
}

/** Echo Show 8's logical display: 1280×800 physical at 4:3 density → 960×600 CSS px (16:10). */
export const ECHO_W = 960;
export const ECHO_H = 600;

/**
 * The Echo Show screen, authored at the device's own resolution and scaled to fit the console, so the
 * MCP App and captions render exactly as they would at arm's length on the device (≥ 24 px type).
 */
export function EchoShowFrame({ children, fill }: { children: ReactNode; fill: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.62);
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = fill ? el.clientHeight : Infinity;
      if (w > 0) setScale(Math.min(w / ECHO_W, h / ECHO_H));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);
  return (
    <div ref={outer} className={`echo-outer ${fill ? "fill" : ""}`} style={fill ? undefined : { height: ECHO_H * scale }}>
      <div
        className="echo-canvas"
        data-theme="dark"
        style={{ width: ECHO_W, height: ECHO_H, transform: `scale(${scale})`, left: fill ? `calc(50% - ${(ECHO_W * scale) / 2}px)` : 0 }}
      >
        {children}
      </div>
    </div>
  );
}

/** Renders the same timeline natively from structuredContent (fallback when the MCP App isn't available). */
export function NativeView({ payload }: { payload: ScreenPayload | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) renderView(ref.current, payload?.result.structuredContent);
  }, [payload]);
  return <div ref={ref} className="op-view screen-fill" />;
}

/**
 * Hosts ui://off-peak/plan.html in a sandboxed iframe and talks to it over the MCP Apps
 * postMessage protocol (ui/initialize, tool-input, tool-result, resource-teardown) via ext-apps' AppBridge.
 */
export function McpAppView({
  html,
  conn,
  payload,
  onFail,
}: {
  html: string;
  conn: McpConn;
  payload: ScreenPayload | null;
  onFail: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<AppBridge | null>(null);
  const ready = useRef(false);
  const latest = useRef<ScreenPayload | null>(payload);
  const sent = useRef<number>(-1);
  const [status, setStatus] = useState("starting");

  const deliver = async () => {
    const p = latest.current;
    if (!bridge.current || !ready.current || !p || sent.current === p.seq)
      return;
    sent.current = p.seq;
    await bridge.current.sendToolInput({ arguments: p.args });
    await bridge.current.sendToolResult(p.result);
  };

  useEffect(() => {
    const iframe = frame.current!;
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!ready.current && !cancelled) onFail();
    }, 4000);
    // Connect the bridge to the iframe's window *before* loading the document: the single-file app
    // sends ui/initialize as soon as it parses, which can beat an onload-time connect.
    // Initial host context goes in the constructor; setHostContext() before connect() rejects ("Not connected").
    const b = new AppBridge(
      conn.client,
      { name: "Alexa+ simulator", version: "0.1.0" },
      { serverTools: {}, logging: {} },
      {
        hostContext: { theme: "dark", displayMode: "inline", platform: "web" },
      },
    );
    b.oninitialized = () => {
      if (cancelled) return;
      ready.current = true;
      setStatus("ready");
      void deliver();
    };
    bridge.current = b;
    const connected = b
      .connect(
        new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
      )
      .then(() => {
        if (!cancelled) iframe.srcdoc = html;
      })
      .catch(() => !cancelled && onFail());
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      bridge.current = null;
      const wasReady = ready.current;
      ready.current = false;
      sent.current = -1;
      void connected.then(async () => {
        if (wasReady) await b.teardownResource({}).catch(() => undefined);
        await b.close().catch(() => undefined);
      });
    };
    // Mount once per app document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, conn]);

  useEffect(() => {
    latest.current = payload;
    void deliver();
  }, [payload]);

  return (
    <iframe
      ref={frame}
      title="Off-Peak plan (MCP App)"
      className="screen-fill app-frame"
      sandbox="allow-scripts"
      data-status={status}
    />
  );
}
