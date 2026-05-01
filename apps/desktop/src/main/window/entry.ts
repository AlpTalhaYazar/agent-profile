import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Vite-injected globals; declared so TypeScript is happy without a vite/client import. */
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

export interface RendererEntryUrlOpts {
  devServerUrl?: string;
  rendererName?: string;
  baseDir?: string;
}

/** Resolve the renderer entry URL for sender-frame validation + window load. */
export function rendererEntryUrl(opts: RendererEntryUrlOpts = {}): string {
  const injectedDevServerUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined"
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : undefined;
  const devServerUrl = opts.devServerUrl ?? injectedDevServerUrl;
  if (devServerUrl) {
    const baseUrl = devServerUrl.endsWith("/") ? devServerUrl : `${devServerUrl}/`;
    return new URL("src/renderer/index.html", baseUrl).toString();
  }

  // Forge plugin-vite emits per-renderer dirs under `.vite/renderer/<name>/`.
  const injectedRendererName =
    typeof MAIN_WINDOW_VITE_NAME !== "undefined" ? MAIN_WINDOW_VITE_NAME : undefined;
  const name = opts.rendererName ?? injectedRendererName ?? "main_window";
  const baseDir = opts.baseDir ?? __dirname;
  const filePath = join(baseDir, "..", "renderer", name, "src", "renderer", "index.html");
  return pathToFileURL(filePath).toString();
}

export interface PreloadEntryPathOpts {
  baseDir?: string;
  exists?: (path: string) => boolean;
}

/** Resolve the preload bundle path across Forge/Vite output variants. */
export function preloadEntryPath(opts: PreloadEntryPathOpts = {}): string {
  const baseDir = opts.baseDir ?? __dirname;
  const exists = opts.exists ?? existsSync;
  const namedPath = join(baseDir, "preload.cjs");
  if (exists(namedPath)) return namedPath;
  return join(baseDir, "index.js");
}
