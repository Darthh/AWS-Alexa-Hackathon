import { iso } from "@off-peak/core";
import { loadConfig } from "../config.ts";
import { log } from "../log.ts";
import { createRuntime, type Runtime } from "../runtime.ts";
import { executeJob } from "../services/plans.ts";

let runtime: Promise<Runtime> | undefined;

/**
 * Executor Lambda: invoked by a one-time EventBridge Scheduler schedule with `{ "jobId": "..." }`.
 * Runs the job against the household in DynamoDB. Idempotent: only pending jobs run.
 */
export async function handler(event: { jobId?: string }): Promise<{ ok: boolean; status?: string }> {
  if (!event?.jobId) return { ok: false };
  runtime ??= createRuntime(loadConfig({ ...process.env, CLOCK: "real", STORE: process.env.STORE ?? "dynamodb", SCHEDULER: "eventbridge" }));
  const rt = await runtime;
  return rt.withLock(async () => {
    const job = await rt.store.getJob(event.jobId!);
    if (!job || job.status !== "pending") return { ok: true, status: job?.status ?? "missing" };
    const h = await rt.household();
    await executeJob(rt, h, job);
    job.ranAt = iso(Date.now(), h.timezone);
    await rt.store.saveJob(job);
    await rt.store.saveHousehold(h);
    log({ msg: "executed", jobId: job.id, kind: job.kind, status: job.status });
    return { ok: true, status: job.status };
  });
}
