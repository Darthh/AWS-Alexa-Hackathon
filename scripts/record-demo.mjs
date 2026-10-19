#!/usr/bin/env node
// Records the running product, including actual MCP calls. No fabricated UI or external footage.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base =
  process.env.DEMO_URL ?? "https://offpeak.patrickvaldivia123.workers.dev";
mkdirSync("out/recording", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  recordVideo: { dir: "out/recording", size: { width: 1600, height: 1000 } },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const video = page.video();
const started = Date.now();
const scenes = [];
const output = resolve("out/offpeak-demo.webm");
const caption = async (title, detail, seconds = 9) => {
  console.log(`Recording: ${title}`);
  scenes.push({
    atSeconds: Math.round((Date.now() - started) / 1000),
    title,
    detail,
  });
  await page.evaluate(
    ({ title, detail }) => {
      let box = document.getElementById("recording-caption");
      if (!box) {
        box = document.createElement("aside");
        box.id = "recording-caption";
        Object.assign(box.style, {
          position: "fixed",
          bottom: "14px",
          left: "24px",
          right: "24px",
          zIndex: "100",
          background: "#182838f5",
          color: "white",
          padding: "15px 22px",
          borderRadius: "7px",
          boxShadow: "0 4px 20px #18283830",
          fontFamily: "system-ui",
          pointerEvents: "none",
        });
        document.body.append(box);
      }
      box.replaceChildren();
      const heading = document.createElement("strong");
      heading.textContent = title;
      heading.style.fontSize = "21px";
      const text = document.createElement("p");
      text.textContent = detail;
      Object.assign(text.style, {
        margin: "5px 0 0",
        fontSize: "16px",
        lineHeight: "1.4",
        color: "#dce7f2",
      });
      box.append(heading, text);
    },
    { title, detail },
  );
  await page.waitForTimeout(seconds * 1000);
};

try {
  await page.goto(base);
  await page.getByText("MCP connected · 17 tools").waitFor();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  const guide = page.getByRole("region", { name: "Guided judge walkthrough" });
  await guide.getByRole("button", { name: "Start guided demo" }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await caption(
    "A cheap schedule must still keep your promises.",
    "OffPeak coordinates EV charging, laundry and dishes. This is an Alexa+ simulator with real MCP traffic and clearly labeled synthetic rates.",
  );

  await guide.getByRole("button", { name: "1. Propose a plan" }).click();
  await page.getByRole("button", { name: "Large screen", exact: true }).click();
  await page
    .frameLocator("iframe.app-frame")
    .locator(".op-title")
    .filter({ hasText: "Proposed plan" })
    .waitFor();
  await caption(
    "The washer now. The dryer after peak. Car and dishes overnight.",
    "The deterministic planner respects quiet hours, dependencies, charging deadlines and the 9.6 kW household limit.",
    12,
  );
  await page
    .getByRole("button", { name: "Exit large screen", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Plan cost and guardrails" })
    .scrollIntoViewIfNeeded();
  await caption(
    "$17.31 run-now task cost → $9.57 proposed task cost.",
    "$7.74 is a modeled difference for these appliances on the synthetic tariff. It is not a measured bill or yearly forecast.",
    10,
  );

  await guide.getByRole("button", { name: "2. Approve and schedule" }).click();
  await page.locator("#simulator").scrollIntoViewIfNeeded();
  await caption(
    "Nothing runs until the customer approves.",
    "Approval schedules real simulator jobs. A conflicting proposal, changed rules, changed tariff or stale start time requires a fresh plan.",
  );

  await guide.getByRole("button", { name: "3. Leave until 9 PM" }).click();
  await page.locator(".house").scrollIntoViewIfNeeded();
  await caption(
    "Away mode saves standby energy without interrupting the evening.",
    "The fridge, router and aquarium stay on. The running washer continues. Cooling waits until peak ends.",
    11,
  );

  await guide.getByRole("button", { name: "4. Explain the TV action" }).click();
  await page.locator(".captions").scrollIntoViewIfNeeded();
  await caption(
    "Why did the TV turn off?",
    "The answer comes from the recorded action and its reason, not a model guessing what happened.",
  );
  await guide.getByRole("button", { name: "5. Restore the TV" }).click();
  await page.locator(".house").scrollIntoViewIfNeeded();
  await caption(
    "Turn it back on.",
    "Undo restores the recorded previous TV state while preserving the rest of the household plan.",
    7,
  );

  await guide.getByRole("button", { name: "6. Finish the night" }).click();
  await page.getByRole("button", { name: "Large screen", exact: true }).click();
  await caption(
    "At 7 AM, the car is at 80% and the jobs have executed.",
    "The week view includes both sides of midnight. Appliance load shifting and room savings are shown separately; all amounts use the synthetic demo rate.",
    11,
  );
  await page
    .getByRole("button", { name: "Exit large screen", exact: true })
    .click();

  await guide.getByRole("button", { name: "7. Use only the office" }).click();
  await page.getByRole("button", { name: "Echo Show", exact: true }).click();
  await page.locator("#simulator").scrollIntoViewIfNeeded();
  await caption(
    "One room, or no screen at all.",
    "Active-room mode keeps the office in use. Voice-only mode preserves the same conversation and MCP tools.",
  );
  await page
    .getByRole("button", { name: "Voice-only (Echo Dot)", exact: true })
    .click();

  await guide.getByRole("button", { name: "Inspect traffic" }).click();
  await page.locator(".rpc").evaluate((table) => {
    table.scrollTop = table.scrollHeight;
  });
  await caption(
    "MCP 2025-11-25 · Streamable HTTP · 17 tools.",
    "The browser initializes, discovers tools and calls them. The Inspector and downloadable receipt expose actual observed traffic.",
    11,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await caption(
    "Rules → presence → electricity price.",
    "Try the live demo. Reuse the MIT tariff library at github.com/Darthh/tou-rates. No live Echo, AWS runtime or guaranteed utility savings are claimed.",
    10,
  );
  await page.evaluate(() =>
    document.getElementById("recording-caption")?.remove(),
  );
  await page.waitForTimeout(1000);
} finally {
  await context.close();
  try {
    // Keep the browser connection alive until Playwright has copied its finalized video.
    await video.saveAs(output);
  } finally {
    await browser.close();
  }
}
writeFileSync(
  "out/recording/scenes.json",
  JSON.stringify(
    {
      source: base,
      mode: "mock",
      durationSeconds: Math.round((Date.now() - started) / 1000),
      scenes,
    },
    null,
    2,
  ),
);
console.log(
  `Recorded ${output}. Convert to MP4 with ffmpeg if needed, then upload to public YouTube/Vimeo before submitting.`,
);
