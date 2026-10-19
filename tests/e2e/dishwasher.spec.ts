import { test, expect } from "@playwright/test";

for (const mode of ["mock", "scripted"] as const) {
  test(`cheapest dishwasher request proposes, approves and runs in ${mode} mode`, async ({ page }) => {
    await page.goto(mode === "scripted" ? "/?mode=scripted&ui=native" : "/");
    await expect(page.getByText("MCP connected · 17 tools")).toBeVisible();
    await page.getByRole("button", { name: "Voice", exact: true }).click();
    const ask = async (text: string) => {
      await page.getByLabel("Message to Alexa").fill(text);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    };
    const state = async () => (await page.request.get("/sim/state")).json();

    await ask("Alexa, when is the cheapest time to run the dishwasher?");
    await expect(page.locator(".cap.alexa")).toContainText("midnight");
    expect((await state()).plan).toBeNull();
    expect((await state()).jobs).toHaveLength(0);

    await ask("Alexa, run the dishwasher when power is cheapest");
    const review = page.getByRole("region", { name: "Plan cost and guardrails" });
    await expect(review).toContainText("Nothing runs until you approve.");
    const proposed = await state();
    expect(proposed.plan.status).toBe("proposed");
    expect(proposed.plan.steps).toHaveLength(1);
    expect(proposed.plan.steps[0]).toMatchObject({ deviceId: "dishwasher" });
    expect(proposed.plan.steps[0].start).toContain("T00:00:00");
    expect(proposed.plan.steps[0].end).toContain("T02:00:00");
    expect(proposed.plan.savingsCents).toBe(30);
    expect(proposed.jobs).toHaveLength(0);

    if (mode === "mock") await ask("Alexa, do it.");
    else await review.getByRole("button", { name: "Approve this plan" }).click();
    await expect(review).toContainText("applied");
    expect((await state()).jobs).toHaveLength(2);

    await page.getByRole("button", { name: "→ Midnight", exact: true }).click();
    await expect.poll(async () => (await state()).household.devices.find((d: { id: string }) => d.id === "dishwasher").state.running).toBe(true);
    await page.getByRole("button", { name: "→ 7 AM", exact: true }).click();
    await expect.poll(async () => (await state()).household.devices.find((d: { id: string }) => d.id === "dishwasher").state.running).toBe(false);
    expect((await state()).jobs).toHaveLength(0);
  });
}
