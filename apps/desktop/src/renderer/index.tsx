/**
 * @module renderer
 *
 * Renderer entrypoint. Mounts the React tree at `#root` and lets
 * `<AppShell />` own the bootstrap effect, screen routing, theme toggle,
 * command palette, and global keyboard shortcuts.
 *
 * The bootstrap effect lives in `components/app-shell.tsx` rather than here
 * — it calls `window.myclaude.system.bootstrap()` once to learn
 * `serverVersion`/`defaultCwd`/`firstRun`/`profileCount` in a single
 * round-trip, then hydrates the matching atoms.
 */

import { createRoot } from "react-dom/client";
import { AppShell } from "./components/app-shell.js";
import "./styles/tokens.css";
import "./global.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<AppShell />);
}
