import { defineConfig } from "vite";

/**
 * Vite config for the Electron Main process bundle.
 *
 * Forge's `plugin-vite` invokes Vite directly for each `build[]` entry; this
 * file is pointed at by `forge.config.ts`. Keep externals broad so workspace
 * deps are bundled but Node built-ins and `electron` are not.
 */
export default defineConfig({
  build: {
    lib: {
      entry: "src/main/index.ts",
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: ["electron", /^node:/],
    },
    sourcemap: true,
    target: "node22",
  },
});
