import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, Implementation, JSONRPCMessage, MessageExtraInfo, Resource, Tool } from "@modelcontextprotocol/sdk/types.js";

/** MCP Apps extension id (exported only from ext-apps/server, which we keep out of the browser bundle). */
const EXTENSION_ID = "io.modelcontextprotocol/ui";

export interface RpcLog {
  seq: number;
  at: number;
  dir: "out" | "in";
  method: string;
  id?: string | number;
  latencyMs?: number;
  bytes: number;
  error?: boolean;
  payload: JSONRPCMessage;
}

/** Wraps the real transport so the Inspector panel can show every JSON-RPC message. */
class LoggingTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  readonly #inner: StreamableHTTPClientTransport;
  readonly #log: (e: RpcLog) => void;
  readonly #pending = new Map<string | number, { method: string; at: number }>();
  #seq = 0;

  constructor(inner: StreamableHTTPClientTransport, log: (e: RpcLog) => void) {
    this.#inner = inner;
    this.#log = log;
  }

  get sessionId() {
    return this.#inner.sessionId;
  }

  get protocolVersion() {
    return this.#inner.protocolVersion;
  }

  setProtocolVersion(version: string): void {
    this.#inner.setProtocolVersion(version);
  }

  #record(dir: "out" | "in", m: JSONRPCMessage): void {
    const now = performance.now();
    const msg = m as { id?: string | number; method?: string; error?: unknown };
    let method = msg.method ?? "";
    let latencyMs: number | undefined;
    if (dir === "out" && msg.method && msg.id !== undefined) this.#pending.set(msg.id, { method: msg.method, at: now });
    if (dir === "in" && !msg.method && msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (p) {
        method = p.method;
        latencyMs = Math.round(now - p.at);
        this.#pending.delete(msg.id);
      }
    }
    this.#log({
      seq: ++this.#seq,
      at: Date.now(),
      dir,
      method: method || "(response)",
      id: msg.id,
      latencyMs,
      bytes: new TextEncoder().encode(JSON.stringify(m)).length,
      error: Boolean(msg.error) || Boolean((m as { result?: { isError?: boolean } }).result?.isError),
      payload: m,
    });
  }

  async start(): Promise<void> {
    this.#inner.onmessage = (m: JSONRPCMessage) => {
      this.#record("in", m);
      this.onmessage?.(m);
    };
    this.#inner.onerror = (e) => this.onerror?.(e);
    this.#inner.onclose = () => this.onclose?.();
    await this.#inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    this.#record("out", message);
    await this.#inner.send(message, options);
  }

  close(): Promise<void> {
    return this.#inner.close();
  }
}

export interface McpConn {
  client: Client;
  protocolVersion: string | undefined;
  server: Implementation | undefined;
  instructions: string | undefined;
  tools: Tool[];
  resources: Resource[];
  uiTools: Set<string>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  readText(uri: string): Promise<string | null>;
}

/** The browser is the MCP client: initialize → tools/list → resources/list over Streamable HTTP. */
export async function connectMcp(url: string, onLog: (e: RpcLog) => void): Promise<McpConn> {
  const client = new Client(
    { name: "alexa-plus-simulator", version: "0.1.0" },
    { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } },
  );
  const transport = new LoggingTransport(new StreamableHTTPClientTransport(new URL(url)), onLog);
  await client.connect(transport);
  const { tools } = await client.listTools();
  const { resources } = await client.listResources();
  const uiTools = new Set(
    tools.filter((t) => (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri).map((t) => t.name),
  );
  return {
    client,
    protocolVersion: transport.protocolVersion,
    server: client.getServerVersion(),
    instructions: client.getInstructions(),
    tools,
    resources,
    uiTools,
    async callTool(name, args) {
      return (await client.callTool({ name, arguments: args })) as CallToolResult;
    },
    async readText(uri) {
      try {
        const r = await client.readResource({ uri });
        const c = r.contents[0] as { text?: string } | undefined;
        return c?.text ?? null;
      } catch {
        return null;
      }
    },
  };
}

export function toolText(r: CallToolResult): string {
  const t = r.content.find((c) => c.type === "text");
  return t && t.type === "text" ? t.text : "";
}

let shared: Promise<McpConn> | null = null;
let logSink: (e: RpcLog) => void = () => undefined;

/** One connection per page, even when React mounts effects twice. */
export function getConnection(url: string, onLog: (e: RpcLog) => void): Promise<McpConn> {
  logSink = onLog;
  shared ??= connectMcp(url, (e) => logSink(e)).catch((err) => {
    shared = null;
    throw err;
  });
  return shared;
}
