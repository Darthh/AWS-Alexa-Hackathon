import "./env.ts"; // first: populate process.env before any config is read
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { log, logError } from "./log.ts";
import { createRuntime } from "./runtime.ts";

process.on("unhandledRejection", (reason) => logError("unhandledRejection", reason));

const config = loadConfig();
const rt = await createRuntime(config);
rt.clock.start();
const app = createApp(rt);

const server = app.listen(config.port, () => {
  log({
    msg: `Off-Peak MCP server on http://localhost:${config.port}/mcp`,
    clock: rt.clock.state(),
    tariff: config.tariffSource,
    store: config.store,
    llm: config.llmMode,
    simAdmin: config.simAdmin,
  });
});

function shutdown() {
  server.close();
  void rt.close().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
