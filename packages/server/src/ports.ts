import type { Device, DeviceState, Household, LedgerEntry, NormalizedTariff, Plan, RuleBody } from "@off-peak/core";

export type JobKind = "step_start" | "step_end" | "precondition" | "restore";

/** A scheduled action. LocalScheduler runs due jobs on clock ticks; EventBridge invokes the executor Lambda. */
export interface Job {
  id: string;
  at: string;
  kind: JobKind;
  status: "pending" | "done" | "cancelled" | "skipped";
  planId?: string;
  stepId?: string;
  deviceId?: string;
  groupId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  ranAt?: string;
  note?: string;
}

export interface Store {
  readonly kind: "memory" | "json" | "dynamodb";
  getHousehold(): Promise<Household | null>;
  saveHousehold(h: Household): Promise<void>;
  getTariff(rateId: string): Promise<NormalizedTariff | null>;
  saveTariff(t: NormalizedTariff): Promise<void>;
  getPlan(id: string): Promise<Plan | null>;
  savePlan(p: Plan): Promise<void>;
  listPlans(): Promise<Plan[]>;
  getJob(id: string): Promise<Job | null>;
  saveJob(j: Job): Promise<void>;
  listJobs(): Promise<Job[]>;
  appendLedger(entries: LedgerEntry[]): Promise<void>;
  updateLedger(entry: LedgerEntry): Promise<void>;
  /** Oldest first. */
  listLedger(opts?: { since?: string }): Promise<LedgerEntry[]>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}

export interface DeviceGateway {
  readonly kind: "sim" | "homeassistant";
  /** Apply a state change in the real (or simulated) world and return the resulting state. */
  apply(device: Device, change: Partial<DeviceState>, at: Date): Promise<DeviceState>;
}

export interface TariffSource {
  readonly kind: "demo" | "fixture" | "openei";
  /** Rate plan used when the household hasn't picked one. */
  defaultRateId(): string;
  findPlans(zip: string): Promise<{ plans: NormalizedTariff[]; source: "openei" | "bundled"; note?: string }>;
  get(rateId: string): Promise<NormalizedTariff | null>;
}

export interface Scheduler {
  readonly kind: "local" | "eventbridge";
  schedule(job: Job): Promise<void>;
  cancel(job: Job): Promise<void>;
}

export interface RuleParser {
  readonly kind: "deterministic" | "bedrock";
  parse(text: string, h: Household): Promise<RuleBody | null>;
}
