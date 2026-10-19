import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.ts";
import type { LlmDeps } from "../src/llm/routes.ts";
import { SimClock } from "../src/clock.ts";
import { loadConfig } from "../src/config.ts";
import { createRuntime, type Runtime } from "../src/runtime.ts";

process.env.OFFPEAK_QUIET = "1";

/** Monday Oct 19 2026, 5:30 PM PDT — the golden-scenario start. */
export const GOLDEN_START = "2026-10-19T17:30:00-07:00";

export interface TestServer {
  rt: Runtime;
  clock: SimClock;
  url: string;
  client: Client;
  transport: StreamableHTTPClientTransport;
  close(): Promise<void>;
}

export async function startTestServer(env: Record<string, string> = {}, start = GOLDEN_START, llm?: LlmDeps): Promise<TestServer> {
  const config = loadConfig({ STORE: "memory", SIM_ADMIN: "1", SIM_START: start, ...env });
  const clock = new SimClock(new Date(start));
  const rt = await createRuntime(config, { clock });
  const app = createApp(rt, { llm });
  const http = app.listen(0);
  await new Promise<void>((resolve) => http.once("listening", () => resolve()));
  const port = (http.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  const client = new Client({ name: "off-peak-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
  await client.connect(transport);
  return {
    rt,
    clock,
    url,
    client,
    transport,
    async close() {
      await client.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await rt.close();
    },
  };
}

export interface ToolCall<T = Record<string, unknown>> {
  text: string;
  data: T;
  isError: boolean;
}

/** Call a tool and return its speakable text + structuredContent. */
export async function call<T = Record<string, any>>(s: TestServer, name: string, args: Record<string, unknown> = {}): Promise<ToolCall<T>> {
  const res = await s.client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
  const data = res.isError ? { error: (res._meta as Record<string, unknown> | undefined)?.["offpeak/error"] } : res.structuredContent;
  return { text, data: data as T, isError: Boolean(res.isError) };
}

/** Jump the sim clock to an ISO time and wait for every tick listener (jobs, idle sweep) to finish. */
export async function jump(s: TestServer, isoTime: string): Promise<void> {
  await s.clock.set(new Date(isoTime));
  await s.clock.settle();
}

/** Speech contract: ≤ 2 sentences, no IDs. */
export function expectSpeakable(text: string): void {
  const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  if (sentences.length > 2) throw new Error(`More than two sentences: ${text}`);
  if (/\b(plan|act|job|grp|rule)_[a-z0-9]+/.test(text)) throw new Error(`Leaks an id: ${text}`);
}
