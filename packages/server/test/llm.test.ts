import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Conversation, type ToolEvent } from "../../web/src/lib/converse.ts";
import { connectMcp, type McpConn } from "../../web/src/lib/mcp.ts";
import { HomeAssistantDevices } from "../src/adapters/homeAssistant.ts";
import { loadConfig } from "../src/config.ts";
import { loadSeedHousehold } from "../src/fixtures.ts";
import { SYSTEM_PROMPT } from "../src/llm/routes.ts";
import { jump, startTestServer, type TestServer } from "./helpers.ts";

const converse = (s: TestServer, body: unknown) =>
  fetch(`${s.url}/llm/converse`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("Bedrock Converse proxy (injected client)", () => {
  let s: TestServer;
  const sent: { name: string; input: Record<string, any> }[] = [];
  let next: () => Promise<unknown> = async () => ({
    output: { message: { role: "assistant", content: [{ text: "It's peak right now." }] } },
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  });

  beforeAll(async () => {
    s = await startTestServer({ LLM_MODE: "bedrock", BEDROCK_MODEL_ID: "test-model" }, undefined, {
      bedrock: {
        send: async (command: any) => {
          sent.push({ name: command.constructor.name, input: command.input });
          return next();
        },
      },
    });
  });
  afterAll(async () => {
    await s.close();
  });

  it("sends the verbatim system prompt, sim-clock context, tools, and no sampling params", async () => {
    const tools = [{ toolSpec: { name: "get_price_now", description: "Price now", inputSchema: { json: { type: "object", properties: {} } } } }];
    const res = await converse(s, { messages: [{ role: "user", content: [{ text: "Is it peak?" }] }], tools });
    const body = (await res.json()) as Record<string, any>;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ mode: "bedrock", stopReason: "end_turn", output: { message: { content: [{ text: "It's peak right now." }] } } });

    const call = sent.at(-1)!;
    expect(call.name).toBe("ConverseCommand");
    expect(call.input.modelId).toBe("test-model");
    expect(call.input.system[0].text).toBe(SYSTEM_PROMPT);
    expect(call.input.system[1].text).toMatch(/Monday, October 19, 5:30 PM/);
    expect(call.input.toolConfig.tools).toEqual(tools);
    expect(call.input.inferenceConfig).toEqual({ maxTokens: 1024 });
  });

  it("maps AWS errors to speakable messages", async () => {
    next = async () => {
      throw Object.assign(new Error("denied"), { name: "AccessDeniedException" });
    };
    const res = await converse(s, { messages: [{ role: "user", content: [{ text: "hi" }] }] });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { speakable: string }).speakable).toBe(
      "This AWS account doesn't have access to that Bedrock model. Switch to scripted mode to keep going.",
    );
  });

  it("explains a missing model id", async () => {
    const t = await startTestServer({ LLM_MODE: "bedrock" });
    const res = await converse(t, { messages: [{ role: "user", content: [{ text: "hi" }] }] });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { speakable: string }).speakable).toMatch(/BEDROCK_MODEL_ID/);
    await t.close();
  });
});

describe("web client conversation loop (mock LLM) through the real proxy and MCP", () => {
  let s: TestServer;
  let conn: McpConn;
  let convo: Conversation;
  const tools: ToolEvent[] = [];

  beforeAll(async () => {
    s = await startTestServer();
    conn = await connectMcp(`${s.url}/mcp`, () => undefined);
    convo = new Conversation(conn, s.url, (e) => tools.push(e));
  });
  afterAll(async () => {
    await conn.client.close();
    await s.close();
  });

  it("runs the demo script turn by turn", async () => {
    expect(conn.protocolVersion).toBe("2025-11-25");
    expect(conn.uiTools).toEqual(new Set(["get_home_status", "plan_tasks", "get_savings"]));

    let r = await convo.askLlm("I need the car charged by 7, dishes and laundry done tonight, nothing loud after 10.");
    expect(r).toMatchObject({ brain: "mock", toolCalls: 1 });
    expect(r.reply).toMatch(/^Here's the plan: .*about \$7\.74 cheaper/);
    expect(tools.at(-1)!.name).toBe("plan_tasks");

    r = await convo.askLlm("Do it.");
    expect(r.reply).toMatch(/^Done, it's all scheduled\./);

    await jump(s, "2026-10-19T18:45:00-07:00");
    r = await convo.askLlm("We're heading out until 9.");
    expect(r.reply).toMatch(/Cooling starts at 9 PM, when peak ends\.$/);

    r = await convo.askLlm("Why did the TV turn off?");
    expect(r.reply).toMatch(/^The TV turned off at 6:45 PM because you left home/);
    r = await convo.askLlm("Turn it back on.");
    expect(r.reply).toBe("Done, the TV is back the way it was.");

    await jump(s, "2026-10-20T07:00:00-07:00");
    r = await convo.askLlm("How much did Off-Peak save me today?");
    expect(r.reply).toMatch(/^Off-Peak saved you about \$7\.74 today on the demo rate, counting the whole overnight schedule\./);
    expect(tools.map((t) => t.name)).toEqual(["plan_tasks", "apply_plan", "set_mode", "explain", "undo", "get_savings"]);
  });

  it("scripted mode gives the same answers without the proxy", async () => {
    const r = await convo.askScripted("What's the price right now?");
    expect(r).toMatchObject({ brain: "scripted", toolCalls: 1 });
    expect(r.reply).toMatch(/^It's off-peak right now: 31 cents/);
  });
});

describe("dishwasher cheapest-time request", () => {
  it.each(["mock", "scripted"] as const)("proposes, confirms and runs the cycle through %s conversation", async (mode) => {
    const s = await startTestServer();
    let conn: McpConn | undefined;
    try {
      conn = await connectMcp(`${s.url}/mcp`, () => undefined);
      const tools: ToolEvent[] = [];
      const convo = new Conversation(conn, s.url, (e) => tools.push(e));
      const ask = (text: string) => mode === "mock" ? convo.askLlm(text) : convo.askScripted(text);

      const proposal = await ask("Alexa, run the dishwasher when power is cheapest");
      expect(proposal.error).not.toBe(true);
      expect(tools.map((t) => t.name)).toEqual(["plan_tasks"]);
      expect(proposal.reply).toMatch(/Should I go ahead\?/);
      const plans = await s.rt.store.listPlans();
      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ status: "proposed", savingsCents: 30, conflicts: [] });
      expect(plans[0]!.steps).toHaveLength(1);
      expect(plans[0]!.steps[0]).toMatchObject({
        deviceId: "dishwasher",
        start: "2026-10-20T00:00:00-07:00",
        end: "2026-10-20T02:00:00-07:00",
      });
      expect(await s.rt.store.listJobs()).toHaveLength(0);

      const approval = await ask("Alexa, do it.");
      expect(approval.error).not.toBe(true);
      expect(tools.map((t) => t.name)).toEqual(["plan_tasks", "apply_plan"]);
      expect((await s.rt.store.listPlans())[0]!.status).toBe("applied");
      expect(await s.rt.store.listJobs()).toHaveLength(2);
      const dishwasher = async () => (await s.rt.household()).devices.find((d) => d.id === "dishwasher")!;
      await jump(s, "2026-10-19T23:59:00-07:00");
      expect(Boolean((await dishwasher()).state.running)).toBe(false);
      await jump(s, "2026-10-20T00:00:00-07:00");
      expect((await dishwasher()).state.running).toBe(true);
      await jump(s, "2026-10-20T02:00:00-07:00");
      expect((await dishwasher()).state.running).toBe(false);
      expect((await s.rt.store.listJobs()).every((job) => job.status === "done")).toBe(true);
    } finally {
      await conn?.client.close();
      await s.close();
    }
  });
});

describe("Home Assistant gateway", () => {
  it("maps device changes to HA service calls and leaves unmapped devices simulated", async () => {
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
      return new Response("[]", { status: 200 });
    }) as typeof fetch;
    const ha = new HomeAssistantDevices(loadConfig({ DEVICES: "homeassistant", HA_URL: "http://ha.local:8123/", HA_TOKEN: "tok" }), fakeFetch);
    const h = loadSeedHousehold({ timezone: "America/Los_Angeles" });
    const dev = (id: string) => h.devices.find((d) => d.id === id)!;

    expect(await ha.apply(dev("tv"), { on: false }, new Date())).toMatchObject({ on: false, powerW: 0 });
    await ha.apply(dev("thermostat"), { setpointF: 82 }, new Date());
    await ha.apply(dev("water_heater"), { ecoMode: true }, new Date());
    await ha.apply(dev("fridge"), { on: true }, new Date());

    expect(calls).toEqual([
      { url: "http://ha.local:8123/api/services/homeassistant/turn_off", body: { entity_id: "media_player.living_room_tv" }, auth: "Bearer tok" },
      { url: "http://ha.local:8123/api/services/climate/set_temperature", body: { entity_id: "climate.home", temperature: 82 }, auth: "Bearer tok" },
      { url: "http://ha.local:8123/api/services/water_heater/set_operation_mode", body: { entity_id: "water_heater.tank", operation_mode: "eco" }, auth: "Bearer tok" },
    ]);
  });
});
