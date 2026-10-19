import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Read VITE_* vars from the repo-root .env (only VITE_-prefixed values reach the bundle).
  envDir: "../..",
  // A local .env copied from .env.example must never point a public Worker at localhost.
  define:
    mode === "worker" ? { "import.meta.env.VITE_MCP_URL": "undefined" } : {},
  server: { port: 5173, strictPort: true },
  preview: { port: 5173 },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
}));
