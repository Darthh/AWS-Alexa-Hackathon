import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./helpers.ts";

describe("MCP protocol over Streamable HTTP", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await startTestServer();
  });
  afterAll(async () => {
    await s.close();
  });

  it("negotiates protocol 2025-11-25", () => {
    expect(s.transport.protocolVersion).toBe("2025-11-25");
    expect(s.client.getServerVersion()).toMatchObject({ name: "off-peak", version: "0.1.0" });
    expect(s.client.getInstructions()).toMatch(/Off-Peak/);
  });

  it("answers a raw initialize with JSON (stateless, no session id)", async () => {
    const res = await fetch(`${s.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = (await res.json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe("2025-11-25");
  });

  it("lists get_price_now with annotations and an output schema", async () => {
    const { tools } = await s.client.listTools();
    const tool = tools.find((t) => t.name === "get_price_now");
    expect(tool).toBeDefined();
    expect(tool!.annotations?.readOnlyHint).toBe(true);
    expect(tool!.outputSchema).toBeDefined();
  });

  it("calls get_price_now on the demo rate", async () => {
    const res = await s.client.callTool({ name: "get_price_now", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ centsPerKwh: 49, periodName: "peak", isDemoRate: true });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    expect(text).toBe("It's peak right now: 49 cents per kilowatt-hour on the demo rate. That lasts until 9 PM, then it's off-peak.");
  });

  it("rejects GET and DELETE in stateless mode", async () => {
    expect((await fetch(`${s.url}/mcp`)).status).toBe(405);
    expect((await fetch(`${s.url}/mcp`, { method: "DELETE" })).status).toBe(405);
  });

  it("sets CORS headers only for WEB_ORIGIN", async () => {
    const ok = await fetch(`${s.url}/mcp`, { method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(ok.headers.get("access-control-allow-headers")).toMatch(/mcp-protocol-version/);
    expect(ok.headers.get("access-control-expose-headers")).toBe("mcp-session-id");
    const bad = await fetch(`${s.url}/mcp`, { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});
