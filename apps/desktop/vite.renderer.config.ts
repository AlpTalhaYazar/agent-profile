import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'";
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:* ws://localhost:*";
const CSP_META_PATTERN = /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*\/>/;

function rendererCspPlugin(command: "build" | "serve"): Plugin {
  return {
    name: "agent-profile-renderer-csp",
    transformIndexHtml(html) {
      const csp = command === "serve" ? DEV_CSP : PROD_CSP;
      return html.replace(
        CSP_META_PATTERN,
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
      );
    },
  };
}

/**
 * Vite config for the Renderer (Chromium) bundle.
 *
 * The Renderer is sandboxed (`sandbox: true`, `nodeIntegration: false`) so this
 * is a vanilla web build. Future UI sprints will add a React plugin here when
 * we wire up shadcn / Jotai; this round only ships a placeholder `index.tsx`.
 */
export default defineConfig(({ command }) => ({
  plugins: [react(), rendererCspPlugin(command)],
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
}));
