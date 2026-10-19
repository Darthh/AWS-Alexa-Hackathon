import { demoTou } from "tou-rates";
import { describe, expect, it } from "vitest";
import { DynamoStore, type DocClient } from "../src/adapters/dynamoStore.ts";
import { atExpression, EventBridgeScheduler, scheduleName } from "../src/adapters/eventBridgeScheduler.ts";
import { loadConfig } from "../src/config.ts";
import { loadSeedHousehold } from "../src/fixtures.ts";
import type { Job } from "../src/ports.ts";

/** In-memory fake of the DynamoDB DocumentClient commands we use. */
function fakeDynamo(): DocClient & { items: Map<string, Record<string, unknown>> } {
  const items = new Map<string, Record<string, unknown>>();
  const key = (k: { pk: string; sk: string }) => `${k.pk}|${k.sk}`;
  return {
    items,
    async send(command: unknown) {
      const name = (command as { constructor: { name: string } }).constructor.name;
      const input = (command as { input: Record<string, any> }).input;
      switch (name) {
        case "PutCommand":
          items.set(key(input.Item), input.Item);
          return {};
        case "GetCommand":
          return { Item: items.get(key(input.Key)) };
        case "DeleteCommand":
          items.delete(key(input.Key));
          return {};
        case "QueryCommand": {
          const pk = input.ExpressionAttributeValues[":pk"];
          const p = input.ExpressionAttributeValues[":p"];
          return { Items: [...items.values()].filter((i) => i.pk === pk && String(i.sk).startsWith(p)).sort((a, b) => String(a.sk).localeCompare(String(b.sk))) };
        }
        case "BatchWriteCommand": {
          for (const reqs of Object.values(input.RequestItems) as any[]) {
            for (const r of reqs) {
              if (r.PutRequest) items.set(key(r.PutRequest.Item), r.PutRequest.Item);
              if (r.DeleteRequest) items.delete(key(r.DeleteRequest.Key));
            }
          }
          return {};
        }
        default:
          throw new Error(`unexpected ${name}`);
      }
    },
  };
}

describe("DynamoStore (single-table)", () => {
  it("round-trips the household as HOUSEHOLD + DEVICE# + RULE# items", async () => {
    const db = fakeDynamo();
    const store = new DynamoStore("OffPeak", "us-east-1", { client: db });
    const h = loadSeedHousehold({ timezone: "America/Los_Angeles" });
    await store.saveHousehold(h);
    expect([...db.items.keys()].filter((k) => k.includes("|DEVICE#"))).toHaveLength(20);
    expect([...db.items.keys()].some((k) => k === "HH#demo-home|HOUSEHOLD")).toBe(true);
    expect(await store.getHousehold()).toEqual(h);

    h.rules = h.rules.filter((r) => r.type !== "max_load");
    await store.saveHousehold(h);
    expect((await store.getHousehold())!.rules.some((r) => r.type === "max_load")).toBe(false);
    expect([...db.items.keys()].some((k) => k.endsWith("RULE#rule_max_load"))).toBe(false);
  });

  it("stores ledger entries under LEDGER#<iso> and filters by time", async () => {
    const store = new DynamoStore("OffPeak", "us-east-1", { client: fakeDynamo() });
    const e = (id: string, at: string) => ({ id, at, action: "off", reason: "r", source: "idle" as const, estSavedCents: 0, estimate: false });
    await store.appendLedger([e("a", "2026-10-19T17:00:00-07:00"), e("b", "2026-10-19T19:00:00-07:00")]);
    expect((await store.listLedger()).map((x) => x.id)).toEqual(["a", "b"]);
    expect((await store.listLedger({ since: "2026-10-19T18:00:00-07:00" })).map((x) => x.id)).toEqual(["b"]);
    await store.saveTariff(demoTou());
    expect((await store.getTariff("DEMO_TOU"))!.name).toBe("Demo rate (synthetic)");
    await store.setMeta("x", 1);
    expect(await store.getMeta("x")).toBe(1);
    await store.setMeta("x", undefined);
    expect(await store.getMeta("x")).toBeUndefined();
  });
});

describe("EventBridgeScheduler", () => {
  const config = loadConfig({ SCHEDULER: "eventbridge", EXECUTOR_LAMBDA_ARN: "arn:aws:lambda:us-east-1:123:function:exec", SCHEDULER_ROLE_ARN: "arn:aws:iam::123:role/sched" });
  const job: Job = { id: "job_1abc", at: "2099-10-19T21:00:00-07:00", kind: "step_start", status: "pending", createdAt: "2099-10-19T17:30:00-07:00" };

  it("builds one-time at() expressions in the household timezone", () => {
    expect(atExpression("2026-10-20T07:00:00Z", "America/Los_Angeles")).toBe("at(2026-10-20T00:00:00)");
    expect(scheduleName(job)).toBe("offpeak-job_1abc");
  });

  it("creates a self-deleting schedule targeting the executor and deletes on cancel", async () => {
    const sent: { name: string; input: any }[] = [];
    const s = new EventBridgeScheduler(config, { send: async (c: any) => void sent.push({ name: c.constructor.name, input: c.input }) });
    await s.schedule(job);
    await s.cancel(job);
    expect(sent[0]).toMatchObject({
      name: "CreateScheduleCommand",
      input: {
        Name: "offpeak-job_1abc",
        ScheduleExpression: "at(2099-10-19T21:00:00)",
        ScheduleExpressionTimezone: "America/Los_Angeles",
        ActionAfterCompletion: "DELETE",
        FlexibleTimeWindow: { Mode: "OFF" },
        Target: { Arn: config.executorLambdaArn, RoleArn: config.schedulerRoleArn, Input: JSON.stringify({ jobId: "job_1abc" }) },
      },
    });
    expect(sent[1]).toMatchObject({ name: "DeleteScheduleCommand", input: { Name: "offpeak-job_1abc" } });
  });

  it("requires the executor and role ARNs", () => {
    expect(() => new EventBridgeScheduler(loadConfig({ SCHEDULER: "eventbridge" }))).toThrow(/EXECUTOR_LAMBDA_ARN/);
  });
});
