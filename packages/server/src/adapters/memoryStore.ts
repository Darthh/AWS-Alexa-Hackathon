import type { Household, LedgerEntry, NormalizedTariff, Plan } from "@off-peak/core";
import type { Job, Store } from "../ports.ts";

export interface StoreData {
  household: Household | null;
  tariffs: Record<string, NormalizedTariff>;
  plans: Record<string, Plan>;
  jobs: Record<string, Job>;
  ledger: LedgerEntry[];
  meta: Record<string, unknown>;
}

export function emptyData(): StoreData {
  return { household: null, tariffs: {}, plans: {}, jobs: {}, ledger: [], meta: {} };
}

const clone = <T>(v: T): T => structuredClone(v);

/** In-process store. Returns copies so callers must save to persist changes. */
export class MemoryStore implements Store {
  readonly kind: "memory" | "json" = "memory";
  protected data: StoreData = emptyData();

  /** Hook for subclasses that persist. */
  protected touched(): void {}

  async getHousehold() {
    return this.data.household ? clone(this.data.household) : null;
  }
  async saveHousehold(h: Household) {
    this.data.household = clone(h);
    this.touched();
  }
  async getTariff(rateId: string) {
    const t = this.data.tariffs[rateId];
    return t ? clone(t) : null;
  }
  async saveTariff(t: NormalizedTariff) {
    this.data.tariffs[t.rateId] = clone(t);
    this.touched();
  }
  async getPlan(id: string) {
    const p = this.data.plans[id];
    return p ? clone(p) : null;
  }
  async savePlan(p: Plan) {
    this.data.plans[p.id] = clone(p);
    this.touched();
  }
  async listPlans() {
    return Object.values(this.data.plans)
      .map(clone)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async getJob(id: string) {
    const j = this.data.jobs[id];
    return j ? clone(j) : null;
  }
  async saveJob(j: Job) {
    this.data.jobs[j.id] = clone(j);
    this.touched();
  }
  async listJobs() {
    return Object.values(this.data.jobs).map(clone);
  }
  async appendLedger(entries: LedgerEntry[]) {
    this.data.ledger.push(...entries.map(clone));
    this.touched();
  }
  async updateLedger(entry: LedgerEntry) {
    const i = this.data.ledger.findIndex((e) => e.id === entry.id);
    if (i >= 0) this.data.ledger[i] = clone(entry);
    this.touched();
  }
  async listLedger(opts: { since?: string } = {}) {
    const since = opts.since ? Date.parse(opts.since) : -Infinity;
    return this.data.ledger
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => Date.parse(e.at) >= since)
      .sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at) || a.i - b.i)
      .map(({ e }) => clone(e));
  }
  async getMeta<T>(key: string) {
    return this.data.meta[key] === undefined ? undefined : clone(this.data.meta[key] as T);
  }
  async setMeta(key: string, value: unknown) {
    if (value === undefined) delete this.data.meta[key];
    else this.data.meta[key] = clone(value);
    this.touched();
  }
  async clear() {
    this.data = emptyData();
    this.touched();
  }
  async flush() {}
}
