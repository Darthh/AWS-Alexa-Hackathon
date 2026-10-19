import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Runtime } from "../runtime.ts";
import { registerTool, type ToolDef } from "./defineTool.ts";
import { registerResources } from "./resources.ts";
import { controlDeviceTool, getHomeStatus } from "./tools/home.ts";
import { applyPlanTool, cancelPlanTool, planTasks } from "./tools/plans.ts";
import { arrivingTool, setModeTool } from "./tools/presence.ts";
import { findCheapestWindow, getPriceNow } from "./tools/price.ts";
import { findRatePlans, selectRatePlan } from "./tools/rates.ts";
import { addRuleTool, listRulesTool, removeRuleTool } from "./tools/rules.ts";
import { explainTool, getSavingsTool, undoTool } from "./tools/trust.ts";

export const SERVER_NAME = "off-peak";
export const SERVER_VERSION = "0.1.0";

export const INSTRUCTIONS =
  "Off-Peak lowers a household's electricity bill by running flexible appliances (EV charging, dishwasher, washer, dryer) in the cheapest hours of the home's real time-of-use rate, and by turning off power nobody is using when the house or a room is empty, while never breaking household rules like charging deadlines, quiet hours, or never-off devices. " +
  "Use get_price_now and find_cheapest_window for price questions, plan_tasks then apply_plan to schedule appliances, set_mode or arriving when people leave, come back, go to sleep, or use only some rooms, and control_device for direct on/off requests. " +
  "Use explain, undo, get_savings and the rule tools when the user asks why something happened, wants it reversed, asks what they saved, or states a household rule.";

export const TOOLS = [
  findRatePlans,
  selectRatePlan,
  getHomeStatus,
  getPriceNow,
  findCheapestWindow,
  planTasks,
  applyPlanTool,
  cancelPlanTool,
  setModeTool,
  arrivingTool,
  controlDeviceTool,
  addRuleTool,
  listRulesTool,
  removeRuleTool,
  explainTool,
  undoTool,
  getSavingsTool,
] as unknown as ToolDef[];

/** A fresh server per HTTP request (stateless mode); all state lives in the runtime's store. */
export function buildServer(rt: Runtime): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  for (const def of TOOLS) registerTool(server, rt, def);
  registerResources(server, rt);
  return server;
}
