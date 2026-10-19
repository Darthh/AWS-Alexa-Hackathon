/** One structured JSON line per event, e.g. {"tool":"plan_tasks","ms":12,"ok":true}. */
export function log(fields: Record<string, unknown>): void {
  if (process.env.OFFPEAK_QUIET === "1") return;
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...fields })}\n`);
}

export function logError(context: string, err: unknown): void {
  const e = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
  process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level: "error", context, ...e })}\n`);
}
