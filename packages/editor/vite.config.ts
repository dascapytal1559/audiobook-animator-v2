import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env["EDITOR_API_PORT"] ?? "63620";
if (!/^\d{1,5}$/.test(apiPort)) throw new Error(`EDITOR_API_PORT must be a port number, got ${JSON.stringify(apiPort)}.`);

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy: { "/api": `http://127.0.0.1:${apiPort}` } },
  build: { outDir: "dist" },
});
