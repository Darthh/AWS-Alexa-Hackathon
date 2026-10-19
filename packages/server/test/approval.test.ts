import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, jump, startTestServer, type TestServer } from "./helpers.ts";

describe("approval requires a current, conflict-free proposal", () => {
  let s: TestServer;
  beforeEach(async () => {
    s = await startTestServer();
  });
  afterEach(async () => {
    await s.close();
  });
  const request = {
    tasks: [
      { device: "washer", finishBy: "tonight" },
      { device: "dryer", finishBy: "tonight" },
      { device: "car" },
    ],
  };

  it("rejects stale proposals without scheduling retroactive appliance starts", async () => {
    const proposal = await call(s, "plan_tasks", request);
    await jump(s, "2026-10-19T18:45:00-07:00");
    const result = await call(s, "apply_plan", { planId: proposal.data.id });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("clock has moved");
    expect(await s.rt.store.listJobs()).toHaveLength(0);
  });

  it("does not reject ordinary confirmation latency", async () => {
    const proposal = await call(s, "plan_tasks", request);
    await jump(s, "2026-10-19T17:30:30-07:00");
    const result = await call(s, "apply_plan", { planId: proposal.data.id });
    expect(result.isError).toBe(false);
    expect(result.data.status).toBe("applied");
  });

  it("requires a new proposal after household constraints change", async () => {
    const proposal = await call(s, "plan_tasks", request);
    const added = await call(s, "add_rule", {
      text: "Nothing loud after 9 PM.",
    });
    expect(added.isError).toBe(false);
    const result = await call(s, "apply_plan", { planId: proposal.data.id });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("fresh plan");
    expect(await s.rt.store.listJobs()).toHaveLength(0);
  });

  it("does not apply costs computed under a different tariff", async () => {
    const proposal = await call(s, "plan_tasks", request);
    const plans = await call(s, "find_rate_plans", { zip: "94110" });
    const alternate = plans.data.plans.find(
      (p: { rateId: string }) => p.rateId !== "DEMO_TOU",
    );
    expect(alternate).toBeTruthy();
    await call(s, "select_rate_plan", { rateId: alternate.rateId });
    expect(
      (await call(s, "apply_plan", { planId: proposal.data.id })).isError,
    ).toBe(true);
    expect(await s.rt.store.listJobs()).toHaveLength(0);
  });

  it("never schedules a partially feasible request while other tasks conflict", async () => {
    await jump(s, "2026-10-19T21:30:00-07:00");
    const proposal = await call(s, "plan_tasks", {
      tasks: [
        { device: "washer", finishBy: "tonight" },
        { device: "dishwasher", finishBy: "07:00" },
      ],
    });
    expect(proposal.data.conflicts.length).toBeGreaterThan(0);
    expect(proposal.data.steps.length).toBeGreaterThan(0);
    const result = await call(s, "apply_plan", { planId: proposal.data.id });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("unresolved conflicts");
    expect(await s.rt.store.listJobs()).toHaveLength(0);
  });
});
