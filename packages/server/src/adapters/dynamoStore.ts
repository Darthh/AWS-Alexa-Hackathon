import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Device, Household, LedgerEntry, NormalizedTariff, Plan, Rule } from "@off-peak/core";
import type { Job, Store } from "../ports.ts";

/** Minimal surface of the DocumentClient we use (injectable for tests). */
export interface DocClient {
  send(command: unknown): Promise<Record<string, unknown>>;
}

type Item = Record<string, unknown> & { pk: string; sk: string };

/**
 * Single-table design, table `OffPeak`:
 *   pk = HH#<householdId>
 *   sk = HOUSEHOLD | DEVICE#<id> | RULE#<id> | PLAN#<id> | STEP#<jobId> | LEDGER#<iso>#<id> | TARIFF#<rateId> | META#<key>
 */
export class DynamoStore implements Store {
  readonly kind = "dynamodb" as const;
  readonly #table: string;
  readonly #pk: string;
  readonly #db: DocClient;

  constructor(table: string, region: string, opts: { householdId?: string; client?: DocClient } = {}) {
    this.#table = table;
    this.#pk = `HH#${opts.householdId ?? "demo-home"}`;
    this.#db =
      opts.client ??
      (DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
        marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
      }) as unknown as DocClient);
  }

  async #query(prefix: string): Promise<Item[]> {
    const out: Item[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.#db.send(
        new QueryCommand({
          TableName: this.#table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": this.#pk, ":p": prefix },
          ExclusiveStartKey: start,
        }),
      );
      out.push(...((res.Items as Item[] | undefined) ?? []));
      start = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (start);
    return out;
  }

  async #get(sk: string): Promise<Item | null> {
    const res = await this.#db.send(new GetCommand({ TableName: this.#table, Key: { pk: this.#pk, sk } }));
    return (res.Item as Item | undefined) ?? null;
  }

  async #put(sk: string, data: unknown): Promise<void> {
    await this.#db.send(new PutCommand({ TableName: this.#table, Item: { pk: this.#pk, sk, data } }));
  }

  async #batch(puts: Item[], deletes: string[]): Promise<void> {
    const requests = [
      ...puts.map((Item) => ({ PutRequest: { Item } })),
      ...deletes.map((sk) => ({ DeleteRequest: { Key: { pk: this.#pk, sk } } })),
    ];
    for (let i = 0; i < requests.length; i += 25) {
      await this.#db.send(new BatchWriteCommand({ RequestItems: { [this.#table]: requests.slice(i, i + 25) } }));
    }
  }

  async getHousehold(): Promise<Household | null> {
    const head = await this.#get("HOUSEHOLD");
    if (!head) return null;
    const [devices, rules] = await Promise.all([this.#query("DEVICE#"), this.#query("RULE#")]);
    const h = head.data as Omit<Household, "devices" | "rules"> & { deviceOrder?: string[]; ruleOrder?: string[] };
    const byId = <T extends { id: string }>(items: Item[], order?: string[]) => {
      const list = items.map((i) => i.data as T);
      return order ? order.map((id) => list.find((x) => x.id === id)).filter((x): x is T => Boolean(x)) : list;
    };
    const { deviceOrder, ruleOrder, ...rest } = h;
    return { ...rest, devices: byId<Device>(devices, deviceOrder), rules: byId<Rule>(rules, ruleOrder) } as Household;
  }

  async saveHousehold(h: Household): Promise<void> {
    const { devices, rules, ...head } = h;
    const existing = await Promise.all([this.#query("DEVICE#"), this.#query("RULE#")]);
    const keep = new Set([...devices.map((d) => `DEVICE#${d.id}`), ...rules.map((r) => `RULE#${r.id}`)]);
    const stale = existing.flat().map((i) => i.sk).filter((sk) => !keep.has(sk));
    await this.#batch(
      [
        { pk: this.#pk, sk: "HOUSEHOLD", data: { ...head, deviceOrder: devices.map((d) => d.id), ruleOrder: rules.map((r) => r.id) } },
        ...devices.map((d) => ({ pk: this.#pk, sk: `DEVICE#${d.id}`, data: d })),
        ...rules.map((r) => ({ pk: this.#pk, sk: `RULE#${r.id}`, data: r })),
      ],
      stale,
    );
  }

  async getTariff(rateId: string) {
    return ((await this.#get(`TARIFF#${rateId}`))?.data as NormalizedTariff | undefined) ?? null;
  }
  async saveTariff(t: NormalizedTariff) {
    await this.#put(`TARIFF#${t.rateId}`, t);
  }
  async getPlan(id: string) {
    return ((await this.#get(`PLAN#${id}`))?.data as Plan | undefined) ?? null;
  }
  async savePlan(p: Plan) {
    await this.#put(`PLAN#${p.id}`, p);
  }
  async listPlans() {
    return (await this.#query("PLAN#")).map((i) => i.data as Plan).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async getJob(id: string) {
    return ((await this.#get(`STEP#${id}`))?.data as Job | undefined) ?? null;
  }
  async saveJob(j: Job) {
    await this.#put(`STEP#${j.id}`, j);
  }
  async listJobs() {
    return (await this.#query("STEP#")).map((i) => i.data as Job);
  }

  #ledgerKey(e: LedgerEntry): string {
    return `LEDGER#${new Date(e.at).toISOString()}#${e.id}`;
  }
  async appendLedger(entries: LedgerEntry[]) {
    await this.#batch(entries.map((e) => ({ pk: this.#pk, sk: this.#ledgerKey(e), data: e })), []);
  }
  async updateLedger(entry: LedgerEntry) {
    await this.#put(this.#ledgerKey(entry), entry);
  }
  async listLedger(opts: { since?: string } = {}) {
    const since = opts.since ? Date.parse(opts.since) : -Infinity;
    return (await this.#query("LEDGER#")).map((i) => i.data as LedgerEntry).filter((e) => Date.parse(e.at) >= since);
  }

  async getMeta<T>(key: string) {
    return (await this.#get(`META#${key}`))?.data as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    if (value === undefined) await this.#db.send(new DeleteCommand({ TableName: this.#table, Key: { pk: this.#pk, sk: `META#${key}` } }));
    else await this.#put(`META#${key}`, value);
  }

  async clear() {
    const all = await this.#query("");
    await this.#batch([], all.map((i) => i.sk));
  }
  async flush() {}
}
