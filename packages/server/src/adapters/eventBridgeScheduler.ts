import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
  SchedulerClient,
} from "@aws-sdk/client-scheduler";
import { DateTime } from "luxon";
import type { Config } from "../config.ts";
import type { Job, Scheduler } from "../ports.ts";

/** Minimal surface of SchedulerClient (injectable for tests). */
export interface SchedulerApi {
  send(command: unknown): Promise<unknown>;
}

/** EventBridge schedule names: ≤ 64 chars of [0-9a-zA-Z-_.]. */
export function scheduleName(job: Job): string {
  return `offpeak-${job.id}`.replace(/[^0-9a-zA-Z\-_.]/g, "-").slice(0, 64);
}

/** `at(yyyy-mm-ddThh:mm:ss)` in the household's local time; EventBridge applies ScheduleExpressionTimezone. */
export function atExpression(isoTime: string, timezone: string): string {
  return `at(${DateTime.fromISO(isoTime, { setZone: true }).setZone(timezone).toFormat("yyyy-LL-dd'T'HH:mm:ss")})`;
}

/**
 * One-time EventBridge Scheduler schedule per job, targeting the executor Lambda, deleted after it fires.
 * Jobs due within a minute are left to the immediate local run (schedules can't be in the past).
 */
export class EventBridgeScheduler implements Scheduler {
  readonly kind = "eventbridge" as const;
  readonly #config: Config;
  readonly #client: SchedulerApi;

  constructor(config: Config, client?: SchedulerApi) {
    if (!config.executorLambdaArn || !config.schedulerRoleArn) {
      throw new Error("SCHEDULER=eventbridge needs EXECUTOR_LAMBDA_ARN and SCHEDULER_ROLE_ARN");
    }
    this.#config = config;
    this.#client = client ?? new SchedulerClient({ region: config.awsRegion });
  }

  async schedule(job: Job): Promise<void> {
    if (Date.parse(job.at) <= Date.now() + 60_000) return;
    await this.#client.send(
      new CreateScheduleCommand({
        Name: scheduleName(job),
        ScheduleExpression: atExpression(job.at, this.#config.householdTz),
        ScheduleExpressionTimezone: this.#config.householdTz,
        FlexibleTimeWindow: { Mode: "OFF" },
        ActionAfterCompletion: "DELETE",
        Target: {
          Arn: this.#config.executorLambdaArn!,
          RoleArn: this.#config.schedulerRoleArn!,
          Input: JSON.stringify({ jobId: job.id }),
        },
      }),
    );
  }

  async cancel(job: Job): Promise<void> {
    try {
      await this.#client.send(new DeleteScheduleCommand({ Name: scheduleName(job) }));
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException) && (err as { name?: string }).name !== "ResourceNotFoundException") throw err;
    }
  }
}
