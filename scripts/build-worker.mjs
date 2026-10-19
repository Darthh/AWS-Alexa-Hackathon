import { build } from "esbuild";
import { resolve } from "node:path";

await build({
  entryPoints: ["worker/index.ts"],
  outfile: "dist/worker/index.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  minify: true,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire("/bundle/index.js");',
  },
  external: ["cloudflare:*", "node:*"],
  loader: { ".html": "text" },
  plugins: [
    {
      name: "bundled-demo-fixtures",
      setup(b) {
        b.onResolve({ filter: /(?:^|\/)fixtures\.ts$/ }, () => ({
          path: resolve("worker/fixtures.ts"),
        }));
      },
    },
  ],
});
console.log(
  "Built Workers demo with the existing Express app, MCP server, planner, and bundled screen.",
);
