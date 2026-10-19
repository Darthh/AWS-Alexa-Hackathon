import { readFileSync } from "node:fs";
import type { Household } from "./types.ts";

/** Test helper: a fresh copy of fixtures/demo-home.json. */
export function demoHome(): Household {
  return JSON.parse(readFileSync(new URL("../../../fixtures/demo-home.json", import.meta.url), "utf8")) as Household;
}
