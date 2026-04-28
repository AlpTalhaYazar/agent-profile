import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite config for the Renderer (Chromium) bundle.
 *
 * The Renderer is sandboxed (`sandbox: true`, `nodeIntegration: false`) so this
 * is a vanilla web build. Future UI sprints will add a React plugin here when
 * we wire up shadcn / Jotai; this round only ships a placeholder `index.tsx`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@agent-profile/ui": resolve(__dirname, "../../packages/ui/src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: "src/renderer/index.html",
      },
    },
    target: "esnext",
    sourcemap: true,
  },
});
