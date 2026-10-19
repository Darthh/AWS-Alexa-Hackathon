import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("guided demo proves the evening and exports observed evidence", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("MCP connected · 17 tools")).toBeVisible();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  const guide = page.getByRole("region", { name: "Guided judge walkthrough" });
  await guide.getByRole("button", { name: "Start guided demo" }).focus();
  await page.keyboard.press("Space");
  await guide.getByRole("button", { name: "1. Propose a plan" }).click();
  const review = page.getByRole("region", { name: "Plan cost and guardrails" });
  await expect(review).toContainText("$17.31");
  await expect(review).toContainText("$9.57");
  await expect(review).toContainText("$7.74");
  await expect(review).toContainText("Nothing runs until you approve.");
  expect(
    (await (await page.request.get("/sim/state")).json()).steps,
  ).toHaveLength(0);
  await guide.getByRole("button", { name: "2. Approve and schedule" }).click();
  for (const name of [
    "3. Leave until 9 PM",
    "4. Explain the TV action",
    "5. Restore the TV",
    "6. Finish the night",
    "7. Use only the office",
  ]) {
    await guide.getByRole("button", { name, exact: true }).click();
  }
  await expect(guide).toContainText("The evening is complete");
  await expect(page.locator(".house .mode-chip")).toContainText("only");
  const download = page.waitForEvent("download");
  await guide
    .getByRole("button", { name: "Download demo receipt", exact: true })
    .click();
  const file = await download;
  const receipt = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(receipt.schema).toBe("offpeak-demo-receipt/v1");
  expect(receipt.measuredUtilitySavings).toBe(false);
  expect(receipt.protocol).toMatchObject({
    version: "2025-11-25",
    toolCount: 17,
    observed: { initialize: true, "tools/list": true, "tools/call": true },
  });
  expect(receipt.plan.projectedSavingsCents).toBe(774);
  expect(receipt.devices.evChargePercent).toBe(80);
  expect(receipt.devices.protected.every((d: { on: boolean }) => d.on)).toBe(
    true,
  );
  expect(receipt.traffic.every((r: object) => !("payload" in r))).toBe(true);
  await page.getByRole("button", { name: "Large screen", exact: true }).click();
  await expect(page.locator(".simulator-panel")).toHaveClass(/presenting/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".simulator-panel")).not.toHaveClass(/presenting/);
});

test("explicit plan approval and stale-plan recovery are visible", async ({
  page,
}) => {
  await page.goto("/?mode=scripted&ui=native");
  await expect(page.getByText("MCP connected · 17 tools")).toBeVisible();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.locator(".chip").first().click();
  const review = page.getByRole("region", { name: "Plan cost and guardrails" });
  await expect(
    review.getByRole("button", { name: "Approve this plan" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "→ 6:45 PM", exact: true }).click();
  await expect(review).toContainText("clock has moved");
  await expect(
    review.getByRole("button", { name: "Approve this plan" }),
  ).toHaveCount(0);
  await review
    .getByRole("button", { name: "Make a fresh evening plan" })
    .click();
  await expect(
    review.getByRole("button", { name: "Approve this plan" }),
  ).toBeVisible();
  await review.getByRole("button", { name: "Approve this plan" }).click();
  await expect(review).toContainText("applied");
});
