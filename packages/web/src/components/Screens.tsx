import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "@off-peak/ui-apps/timeline.css";
import { renderView } from "@off-peak/ui-apps/timeline";
import { useEffect, useRef, useState } from "react";
import type { McpConn } from "../lib/mcp.ts";

export interface ScreenPayload {
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  result: CallToolResult;
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
        hostContext: { theme: "light", displayMode: "inline", platform: "web" },
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
