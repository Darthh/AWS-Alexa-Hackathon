import { App } from "@modelcontextprotocol/ext-apps";
import "./timeline.css";
import { renderView } from "./timeline.ts";

/**
 * MCP App for ui://off-peak/plan.html. The host sends ui/notifications/tool-input and
 * ui/notifications/tool-result over postMessage; we render from structuredContent only.
 */
const root = document.getElementById("root")!;
const app = new App({ name: "off-peak-plan", version: "0.1.0" }, {}, { autoResize: true });

app.ontoolinput = () => {
  if (!root.childElementCount) root.textContent = "Working on it…";
};

app.ontoolresult = (params) => {
  if (params.isError) {
    const text = params.content?.find((c) => c.type === "text");
    root.textContent = text && "text" in text ? text.text : "Something went wrong.";
    return;
  }
  renderView(root, params.structuredContent);
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) document.documentElement.dataset.theme = ctx.theme;
};

app.onteardown = async () => {
  root.replaceChildren();
  return {};
};

await app.connect();
const theme = app.getHostContext()?.theme;
if (theme) document.documentElement.dataset.theme = theme;
