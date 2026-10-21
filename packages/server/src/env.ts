import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Load the repo-root .env if there is one. Done in code rather than with `node --env-file-if-exists`
 * because Node 22's `--watch` crashes on a missing env file (it tries to watch it), which broke
 * `npm run dev` on a fresh clone with no .env. Variables already in the environment win.
 */
const file = new URL("../../../.env", import.meta.url);
if (existsSync(file)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
