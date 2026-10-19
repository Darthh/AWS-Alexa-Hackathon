#!/usr/bin/env node
// Exports packages/tou-rates as a standalone, publishable repo (Open Source mini challenge).
// Usage: node scripts/export-tou-rates.mjs [outDir]   (default: out/tou-rates)
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkgDir = join(root, "packages/tou-rates");
const out = resolve(process.argv[2] ?? join(root, "out/tou-rates"));
// Only regenerate the dedicated export workspace, never a caller-selected source directory.
if (out !== resolve(root, "out/tou-rates"))
  throw new Error(
    "Export to out/tou-rates; copy that generated directory if you need another destination.",
  );
const self = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const base = JSON.parse(readFileSync(join(root, "tsconfig.base.json"), "utf8"));

rmSync(join(out, "src"), { recursive: true, force: true });
mkdirSync(join(out, "fixtures"), { recursive: true });
cpSync(join(pkgDir, "src"), join(out, "src"), { recursive: true });
for (const f of ["README.md", "LICENSE"]) cpSync(join(pkgDir, f), join(out, f));
for (const f of readdirSync(join(root, "fixtures/tariffs")))
  cpSync(join(root, "fixtures/tariffs", f), join(out, "fixtures", f));

// Tests read fixtures from the monorepo root; point them at ./fixtures instead.
for (const f of readdirSync(join(out, "src")).filter((x) =>
  x.endsWith(".test.ts"),
)) {
  const p = join(out, "src", f);
  writeFileSync(
    p,
    readFileSync(p, "utf8").replaceAll(
      "../../../fixtures/tariffs/",
      "../fixtures/",
    ),
  );
}

const pkg = {
  name: "tou-rates",
  version: self.version,
  description: self.description,
  license: "MIT",
  type: "module",
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  files: ["dist", "README.md", "LICENSE"],
  keywords: self.keywords,
  repository: { type: "git", url: "https://github.com/Darthh/tou-rates.git" },
  engines: { node: ">=22.18" },
  scripts: {
    build: "tsc -p tsconfig.build.json",
    test: "vitest run",
    typecheck: "tsc -p tsconfig.json",
    prepare: "npm run build",
    prepublishOnly: "npm test && npm run build",
  },
  dependencies: self.dependencies,
  devDependencies: {
    "@types/luxon": "^3.7.6",
    "@types/node": "^22.19.0",
    typescript: "6.0.3",
    vitest: "5.0.5",
  },
};
writeFileSync(join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(
  join(out, "tsconfig.json"),
  `${JSON.stringify({ compilerOptions: base.compilerOptions, include: ["src"] }, null, 2)}\n`,
);
writeFileSync(
  join(out, "tsconfig.build.json"),
  `${JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: false, allowImportingTsExtensions: false, rewriteRelativeImportExtensions: true, declaration: true, sourceMap: true, rootDir: "src", outDir: "dist" }, exclude: ["src/**/*.test.ts"] }, null, 2)}\n`,
);
writeFileSync(join(out, ".gitignore"), "node_modules/\ndist/\n");
console.log(
  `Exported tou-rates to ${out}\nNext: cd ${out} && npm install && npm test && npm run build`,
);
