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
  build: {
    target: "esnext",
    sourcemap: true,
  },
});
