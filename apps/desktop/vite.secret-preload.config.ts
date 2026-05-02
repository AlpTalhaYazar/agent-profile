import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: ".vite/build",
    rollupOptions: {
      external: ["electron", /^node:/],
      output: {
        assetFileNames: "secret-dialog-preload.[ext]",
        chunkFileNames: "secret-dialog-preload.cjs",
        entryFileNames: "secret-dialog-preload.cjs",
      },
    },
    sourcemap: true,
    target: "node22",
  },
});
