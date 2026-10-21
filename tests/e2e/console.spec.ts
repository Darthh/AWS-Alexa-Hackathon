import { test, expect, type Page } from "@playwright/test";

const plan =
  "I need the car charged by 7, dishes and laundry done tonight, nothing loud after 10.";
const shotDir = process.env.UPDATE_SCREENSHOTS ? "docs/screenshots" : null;

async function ready(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.getByText("MCP 2025-11-25 · Streamable HTTP · 17 tools")).toBeVisible();
  await expect(page.locator(".zones .dev")).toHaveCount(20);
  // Keep automated browser runs silent.
  await page.getByRole("button", { name: "Voice", exact: true }).click();
}

async function ask(page: Page, text: string) {
  await page.getByRole("button", { name: text, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".cap.alexa")).toBeVisible();
}

test("all console controls remain available and operate", async ({ page }) => {
  await ready(page);
  await expect(page.locator(".chip")).toHaveCount(8);
  await expect(page.locator("iframe.app-frame")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await page
    .getByRole("button", { name: "Brain: Mock LLM", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Brain: Scripted (no LLM)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Brain: Scripted (no LLM)" }).click();
  await page.getByRole("button", { name: "Echo Show", exact: true }).click();
  await expect(page.locator(".dot-ring")).toBeVisible();
  await page
    .getByRole("button", { name: "Voice-only (Echo Dot)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Screen: MCP App", exact: true })
    .click();
  await expect(page.locator(".screen .op-view .op-title")).toHaveText("Home");
  await page
    .getByRole("button", { name: "Screen: native", exact: true })
    .click();
  await expect(page.locator("iframe.app-frame")).toHaveAttribute(
    "data-status",
    "ready",
  );

  const kitchen = page
    .locator(".zone")
    .filter({ has: page.getByText("Kitchen", { exact: true }) })
    .getByRole("checkbox");
  await kitchen.click();
  await expect(kitchen).not.toBeChecked();
  await kitchen.click();
  await expect(kitchen).toBeChecked();
  for (const speed of ["1×", "600×", "60×"]) {
    await page.getByRole("button", { name: speed, exact: true }).click();
    await expect(
      page.getByRole("button", { name: speed, exact: true }),
    ).toHaveClass(/active/);
  }
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "⏸ Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "⏸ Pause", exact: true }).click();
  await page.getByRole("button", { name: "→ 5:30 PM", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".clock-time")).toContainText("5:30 PM");

  await page
    .locator("nav")
    .getByRole("button", { name: "MCP Inspector", exact: true })
    .click();
  await expect(page.getByRole("tabpanel")).toContainText("Streamable HTTP");
  await page.getByLabel("hide notifications").uncheck();
  await page.locator(".rpc-row").first().click();
  await expect(page.locator(".rpc-payload pre")).toBeVisible();
  await page
    .getByRole("tab", { name: "Ledger & savings", exact: true })
    .click();
  await expect(page.getByRole("tabpanel")).toContainText("saved today");
  await expect(
    page.getByRole("button", { name: "Hold to talk", exact: true }),
  ).toBeVisible();
});

test("the full evening still plans, applies, explains, undoes and saves", async ({
  page,
}) => {
  await ready(page);
  await ask(page, plan);
  const screen = page.frameLocator("iframe.app-frame");
  await expect(screen.locator(".op-view")).toContainText("7.74");
  if (shotDir) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${shotDir}/01-plan.png`, fullPage: true });
  }
  await ask(page, "Do it.");
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/sim/state")).json()).steps.filter(
          (s: { status: string }) => s.status === "running",
        ).length,
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "→ 6:45 PM", exact: true }).click();
  await ask(page, "We're heading out until 9.");
  await expect(page.locator(".house .mode-chip")).toContainText("away");
  if (shotDir) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${shotDir}/02-away.png`, fullPage: true });
  }
  await ask(page, "Why did the TV turn off?");
  await expect(page.locator(".cap.alexa")).toContainText(
    /TV|Living room|away/i,
  );
  await ask(page, "Turn it back on.");
  const tv = page
    .locator(".dev")
    .filter({ has: page.getByText("TV", { exact: true }) });
  await expect(tv).toHaveClass(/\bon\b/);
  await ask(page, "It's just me in the office.");
  await expect(page.locator(".house .mode-chip")).toContainText("only");
  await ask(page, "What's the price right now?");
  for (const jump of ["→ 9 PM", "→ Midnight", "→ 7 AM"])
    await page.getByRole("button", { name: jump, exact: true }).click();
  await expect
    .poll(async () => {
      const snap = await (await page.request.get("/sim/state")).json();
      return snap.household.devices.find(
        (d: { kind: string }) => d.kind === "ev_charger",
      ).battery.socPercent;
    })
    .toBe(80);
  await ask(page, "How much did Off-Peak save me today?");
  await expect(screen.locator(".sv-total")).toBeVisible();
  if (shotDir) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `${shotDir}/03-savings.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Echo Show", exact: true }).click();
  await expect(page.locator(".dot-ring")).toBeVisible();
  if (shotDir) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `${shotDir}/04-voice-only.png`,
      fullPage: true,
    });
  }
});

test("scripted/native fallback, typed messages, persistence, and visitor isolation", async ({
  page,
  browser,
  baseURL,
}) => {
  await ready(page, "?mode=scripted&ui=native");
  await ask(page, plan);
  await expect(page.locator(".screen .op-view")).toContainText("7.74");
  await ask(page, "Do it.");
  const state = await (await page.request.get("/sim/state")).json();
  await page.reload();
  await expect(page.getByText("MCP 2025-11-25 · Streamable HTTP · 17 tools")).toBeVisible();
  const persisted = await (await page.request.get("/sim/state")).json();
  expect(persisted.steps.length).toBe(state.steps.length);
  await page.getByLabel("Message to Alexa").fill("What's the price right now?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".cap.alexa")).toContainText(/49|peak/i);
  const other = await browser.newContext({ baseURL });
  await other.request.get("/");
  const isolated = await (await other.request.get("/sim/state")).json();
  expect(isolated.steps).toHaveLength(0);
  expect(
    isolated.household.devices.find(
      (d: { kind: string }) => d.kind === "ev_charger",
    ).battery.socPercent,
  ).toBe(35);
  const csrf = await page.request.post("/sim/reset", {
    headers: { origin: "https://example.com" },
  });
  expect(csrf.status()).toBe(403);
  await other.close();
});

test("the responsive console keeps controls within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "?ui=native");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Household", exact: true })
    .click();
  await expect(page.locator(".sidebar")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#simulator").scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Message to Alexa")).toBeVisible();
});
