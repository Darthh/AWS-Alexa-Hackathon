#!/usr/bin/env node
// Starts the MCP server (:8787) and the web client (:5173) with prefixed output.
// Zero dependencies; Ctrl-C stops both.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Execute npm's JS entry point through Node; spawning npm.cmd fails with EINVAL on Windows.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Start this script with npm run dev.");

function hasScript(pkgDir, script) {
  const file = join(root, pkgDir, "package.json");
  if (!existsSync(file)) return false;
  return Boolean(JSON.parse(readFileSync(file, "utf8")).scripts?.[script]);
}

// The MCP App (plan timeline) is a single-file build the server serves as a resource.
if (hasScript("packages/ui-apps", "build")) {
  const r = spawnSync(
    process.execPath,
    [npmCli, "run", "build", "-w", "@off-peak/ui-apps"],
    { cwd: root, stdio: "inherit" },
  );
  if (r.status !== 0)
    console.warn(
      "[dev] ui-apps build failed; the web client will use the native timeline.",
    );
}

const procs = [
  { name: "server", color: 36, dir: "packages/server", ws: "@off-peak/server" },
  { name: "web", color: 35, dir: "packages/web", ws: "@off-peak/web" },
].filter((p) => hasScript(p.dir, "dev"));

const env = { SIM_ADMIN: "1", ...process.env };
const children = procs.map((p) => {
  // Own process group, so shutdown reaches npm's children too (and `node --watch` can't respawn the server).
  const child = spawn(process.execPath, [npmCli, "run", "dev", "-w", p.ws], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const prefix = `\x1b[${p.color}m[${p.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) out.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function killTree(child, signal) {
  try {
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) killTree(c, "SIGTERM");
  setTimeout(() => {
    for (const c of children) killTree(c, "SIGKILL");
    process.exit(code);
  }, 1500);
}
process.on("exit", () => {
  for (const c of children) killTree(c, "SIGKILL");
});
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
