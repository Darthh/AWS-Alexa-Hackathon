import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.ts";
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

export async function startTestServer(env: Record<string, string> = {}, start = GOLDEN_START): Promise<TestServer> {
  const config = loadConfig({ STORE: "memory", SIM_ADMIN: "1", ...env });
  const clock = new SimClock(new Date(start));
  const rt = await createRuntime(config, { clock });
  const app = createApp(rt);
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
