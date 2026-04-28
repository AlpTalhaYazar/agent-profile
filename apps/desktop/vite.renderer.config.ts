import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the Renderer (Chromium) bundle.
 *
 * The Renderer is sandboxed (`sandbox: true`, `nodeIntegration: false`) so this
 * is a vanilla web build. Future UI sprints will add a React plugin here when
 * we wire up shadcn / Jotai; this round only ships a placeholder `index.tsx`.
 */
export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  build: {
    target: "esnext",
    sourcemap: true,
  },
});
