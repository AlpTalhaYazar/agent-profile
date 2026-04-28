import { defineConfig } from "vite";

/**
 * Vite config for the Electron preload bundle.
 *
 * Preload runs in an isolated context with `contextIsolation: true`. The only
 * way it can talk to Main is via `ipcRenderer.invoke` and the only way it can
 * expose anything to the Renderer is via `contextBridge`. See
 * `src/preload/index.ts` for the surface and the channel-naming convention.
 */
export default defineConfig({
  build: {
    lib: {
      entry: "src/preload/index.ts",
      formats: ["cjs"],
      fileName: () => "preload.cjs",
    },
    rollupOptions: {
      external: ["electron", /^node:/],
    },
    sourcemap: true,
    target: "node22",
  },
});
