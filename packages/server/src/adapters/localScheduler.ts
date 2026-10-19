import type { Job, Scheduler } from "../ports.ts";

/** Jobs live in the Store; the runtime runs due jobs whenever the clock ticks (sim or real). */
export class LocalScheduler implements Scheduler {
  readonly kind = "local" as const;
  async schedule(_job: Job): Promise<void> {}
  async cancel(_job: Job): Promise<void> {}
}
