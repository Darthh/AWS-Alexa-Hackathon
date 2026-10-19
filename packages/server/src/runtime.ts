import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { iso, type Household, type NormalizedTariff } from "@off-peak/core";
import { demoTou } from "tou-rates";
import { JsonFileStore } from "./adapters/jsonFileStore.ts";
import { LocalScheduler } from "./adapters/localScheduler.ts";
import { MemoryStore } from "./adapters/memoryStore.ts";
import { SimDevices } from "./adapters/simDevices.ts";
import { DemoTariffs, FixtureTariffs, OpenEITariffs } from "./adapters/tariffs.ts";
import { type Clock, defaultSimStart, RealClock, SimClock } from "./clock.ts";
import type { Config } from "./config.ts";
import { loadSeedHousehold } from "./fixtures.ts";
import { log } from "./log.ts";
import type { DeviceGateway, RuleParser, Scheduler, Store, TariffSource } from "./ports.ts";
import { DEFAULT_OCCUPANCY } from "./services/presence.ts";
import { onTick } from "./services/tick.ts";

export interface Runtime {
  /** Prebundled screen for runtimes without a repository filesystem (e.g. Workers). */
  planAppHtml?: string;
  config: Config;
  clock: Clock;
  timezone: string;
  store: Store;
  tariffs: TariffSource;
  devices: DeviceGateway;
  scheduler: Scheduler;
  ruleParser: RuleParser;
  /** Emits "changed" whenever household, jobs, ledger or clock change (drives the SSE house panel). */
  events: EventEmitter;
  newId(prefix: string): string;
  household(): Promise<Household>;
  currentTariff(h?: Household): Promise<NormalizedTariff>;
  /** Serialize all mutations (tool calls, ticks, sim admin) so read-modify-write never races. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  changed(reason: string): void;
  /** Reset to the seed household and the sim start time. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeOverrides {
  planAppHtml?: string;
  clock?: Clock;
  store?: Store;
  tariffs?: TariffSource;
  devices?: DeviceGateway;
  scheduler?: Scheduler;
  ruleParser?: RuleParser;
}

async function makeStore(config: Config): Promise<Store> {
  if (config.store === "memory") return new MemoryStore();
  if (config.store === "dynamodb") {
    const { DynamoStore } = await import("./adapters/dynamoStore.ts");
    return new DynamoStore(config.ddbTable, config.awsRegion);
  }
  return new JsonFileStore(join(config.dataDir, "offpeak.json"));
}

function makeTariffs(config: Config): TariffSource {
  if (config.tariffSource === "openei") return new OpenEITariffs(config.openeiApiKey ?? "DEMO_KEY", config.householdTz);
  if (config.tariffSource === "fixture") return new FixtureTariffs(config.householdTz);
  return new DemoTariffs(config.householdTz);
}

async function makeScheduler(config: Config): Promise<Scheduler> {
  if (config.scheduler === "eventbridge") {
    const { EventBridgeScheduler } = await import("./adapters/eventBridgeScheduler.ts");
    return new EventBridgeScheduler(config);
  }
  return new LocalScheduler();
}

async function makeDevices(config: Config): Promise<DeviceGateway> {
  if (config.devices === "homeassistant") {
    const { HomeAssistantDevices } = await import("./adapters/homeAssistant.ts");
    return new HomeAssistantDevices(config);
  }
  return new SimDevices();
}

async function makeRuleParser(config: Config): Promise<RuleParser> {
  const { DeterministicRuleParser, BedrockRuleParser } = await import("./adapters/ruleParsers.ts");
  return config.ruleParser === "bedrock" ? new BedrockRuleParser(config) : new DeterministicRuleParser();
}

function simStart(config: Config): Date {
  return config.simStart ? new Date(config.simStart) : defaultSimStart(config.householdTz);
}

export async function createRuntime(config: Config, overrides: RuntimeOverrides = {}): Promise<Runtime> {
  const timezone = config.householdTz;
  const store = overrides.store ?? (await makeStore(config));
  const tariffs = overrides.tariffs ?? makeTariffs(config);

  let clock = overrides.clock;
  if (!clock) {
    if (config.clock === "real") clock = new RealClock();
    else {
      const saved = config.simStart ? undefined : await store.getMeta<string>("sim.now");
      clock = new SimClock(saved ? new Date(saved) : simStart(config));
    }
  }

  /** Seed household; rooms with people in them start with fresh motion. */
  const seed = (at: Date) => {
    const h = loadSeedHousehold({ timezone, zip: config.demoZip });
    h.rateId = tariffs.defaultRateId();
    for (const z of h.zones) if (DEFAULT_OCCUPANCY[z.id]) z.lastMotionAt = iso(at.getTime(), timezone);
    return h;
  };

  if (!(await store.getHousehold())) await store.saveHousehold(seed(clock.now()));

  let chain: Promise<unknown> = Promise.resolve();
  let counter = 0;
  const events = new EventEmitter();
  events.setMaxListeners(100);

  const rt: Runtime = {
    planAppHtml: overrides.planAppHtml,
    config,
    clock,
    timezone,
    store,
    tariffs,
    devices: overrides.devices ?? (await makeDevices(config)),
    scheduler: overrides.scheduler ?? (await makeScheduler(config)),
    ruleParser: overrides.ruleParser ?? (await makeRuleParser(config)),
    events,
    newId(prefix) {
      counter += 1;
      return `${prefix}_${counter.toString(36)}${randomUUID().slice(0, 6)}`;
    },
    async household() {
      const h = await store.getHousehold();
      if (!h) throw new Error("No household in store");
      return h;
    },
    async currentTariff(h) {
      const household = h ?? (await rt.household());
      const rateId = household.rateId ?? tariffs.defaultRateId();
      return (await store.getTariff(rateId)) ?? (await tariffs.get(rateId)) ?? demoTou(timezone);
    },
    withLock<T>(fn: () => Promise<T>): Promise<T> {
      const run = chain.then(fn, fn) as Promise<T>;
      chain = run.catch(() => undefined);
      return run;
    },
    changed(reason) {
      events.emit("changed", reason);
    },
    async reset() {
      await rt.withLock(async () => {
        await store.clear();
        await store.saveHousehold(seed(clock instanceof SimClock ? simStart(config) : clock.now()));
      });
      if (clock instanceof SimClock) {
        clock.pause();
        await clock.set(simStart(config));
      }
      rt.changed("reset");
      log({ msg: "sim reset", now: clock.now().toISOString() });
    },
    async close() {
      clock.stop();
      await clock.settle();
      await chain.catch(() => undefined);
      await store.flush();
    },
  };

  clock.onTick((now, prev) => rt.withLock(() => onTick(rt, now, prev)).then(() => rt.changed("tick")));
  return rt;
}
