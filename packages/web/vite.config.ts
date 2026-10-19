import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Read VITE_* vars from the repo-root .env (only VITE_-prefixed values reach the bundle).
  envDir: "../..",
  server: { port: 5173, strictPort: true },
  preview: { port: 5173 },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
