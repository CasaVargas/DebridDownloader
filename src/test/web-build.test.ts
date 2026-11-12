// @vitest-environment node
// Vite's config loads esbuild, which needs Node's own TextEncoder rather than jsdom's.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vite.config.ts belongs to tsconfig.node.json, so load it by path rather than a typed import.
const viteConfig = resolve(__dirname, "../../vite.config.ts");
const { default: config, WEB_OUT_DIR } = await import(/* @vite-ignore */ viteConfig);

type Resolve = (env: { mode: string; command: string }) => Promise<{ build: { outDir?: string; emptyOutDir?: boolean } }>;

describe("web build", () => {
  it("vite --mode web (npm run build:web) writes the browser bundle to dist-web", async () => {
    expect(WEB_OUT_DIR).toBe("dist-web");
    const web = await (config as unknown as Resolve)({ mode: "web", command: "build" });
    expect(web.build).toEqual({ outDir: "dist-web", emptyOutDir: true });
  });

  it("the desktop build keeps Vite's default dist/, which tauri.conf.json bundles", async () => {
    const desktop = await (config as unknown as Resolve)({ mode: "production", command: "build" });
    expect(desktop.build.outDir).toBeUndefined();
  });
});
