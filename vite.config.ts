import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/** Where `npm run build:web` (Vite mode `web`) writes the browser UI the headless server serves. */
export const WEB_OUT_DIR = "dist-web";

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => ({
  plugins: [react(), tailwindcss()],

  // `--mode web`: the browser bundle for `debriddownloader-headless --web-dir dist-web`. It always
  // uses the HTTP transport (src/api/transport.ts) and leaves the desktop bundle in dist/ alone.
  build: mode === "web" ? { outDir: WEB_OUT_DIR, emptyOutDir: true } : {},

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
