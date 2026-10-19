#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = (
  process.env.DEMO_URL ?? "https://offpeak.patrickvaldivia123.workers.dev"
).replace(/\/$/, "");
const target = new URL(base);
if (
  target.protocol !== "https:" &&
  !["127.0.0.1", "localhost"].includes(target.hostname)
)
  throw new Error("Use HTTPS or a loopback demo URL.");
const required = [
  "README.md",
  "LICENSE",
  "SUBMISSION.md",
  "DEMO_SCRIPT.md",
  "FEEDBACK.md",
  "FRICTION_LOG.md",
  "FEATURE_REQUESTS.md",
  "docs/hackathon-readiness.md",
];
const documents = Object.fromEntries(
  required.map((file) => [file, existsSync(resolve(file))]),
);
const sdk = JSON.parse(readFileSync("packages/server/package.json", "utf8"))
  .dependencies["@modelcontextprotocol/sdk"];
const page = await fetch(base);
if (!page.ok) throw new Error(`Demo failed: HTTP ${page.status}`);
const cookie = page.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
let id = 0;
const call = async (method, params) => {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      cookie,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
};
const initialize = await call("initialize", {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "offpeak-submission-check", version: "1.0.0" },
});
const { tools } = await call("tools/list", {});
const price = await call("tools/call", {
  name: "get_price_now",
  arguments: {},
});
const { resources } = await call("resources/list", {});
const report = {
  capturedAt: new Date().toISOString(),
  url: base,
  documents,
  sdk,
  protocol: initialize.protocolVersion,
  transport: "Streamable HTTP",
  tools: tools.map((t) => t.name),
  resources: resources.map((r) => ({ uri: r.uri, mimeType: r.mimeType })),
  priceCallSucceeded: !price.isError,
  simulatedDemo: true,
  notProven: [
    "Devpost submission",
    "public YouTube/Vimeo video",
    "real Alexa device",
    "live AWS runtime services",
    "team eligibility",
  ],
};
if (
  initialize.protocolVersion !== "2025-11-25" ||
  tools.length !== 17 ||
  price.isError ||
  Object.values(documents).includes(false) ||
  !sdk.startsWith("1.")
)
  throw new Error("Submission check did not pass: " + JSON.stringify(report));
mkdirSync("out", { recursive: true });
writeFileSync("out/submission-check.json", JSON.stringify(report, null, 2));
console.log(
  `Verified ${report.protocol}, ${tools.length} tools, ${resources.length} resources, and a real get_price_now call at ${base}.`,
);
console.log(
  "Evidence: out/submission-check.json. Human submission requirements remain listed in docs/hackathon-readiness.md.",
);
