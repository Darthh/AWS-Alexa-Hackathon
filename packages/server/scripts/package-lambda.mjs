// Copies runtime assets next to the Lambda bundle: fixtures, the MCP App HTML, and the Web Adapter start script.
import { chmodSync, cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../../", import.meta.url).pathname;
const out = new URL("../dist-lambda/", import.meta.url).pathname;
cpSync(join(root, "fixtures"), join(out, "fixtures"), { recursive: true });
const app = join(root, "packages/ui-apps/dist/plan.html");
if (existsSync(app)) cpSync(app, join(out, "plan.html"));
else console.warn("ui-apps not built; the MCP App resource will show a placeholder");
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }, null, 2));
writeFileSync(join(out, "run.sh"), "#!/bin/bash\nexec node /var/task/main.mjs\n");
chmodSync(join(out, "run.sh"), 0o755);
console.log(`Lambda bundle ready in ${out}`);
