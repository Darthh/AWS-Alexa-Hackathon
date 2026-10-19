import { defineConfig } from "vite";

// Bundles the MCP server (run behind the AWS Lambda Web Adapter) and the EventBridge executor
// into self-contained ESM files for Lambda. `npm run build:lambda` then copies fixtures + the MCP App.
export default defineConfig({
  build: {
    ssr: true,
    outDir: "dist-lambda",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      input: { main: "src/main.ts", executor: "src/lambda/executor.ts" },
      output: { format: "esm", entryFileNames: "[name].mjs", chunkFileNames: "chunks/[name]-[hash].mjs" },
    },
  },
  ssr: { noExternal: true, target: "node" },
});
