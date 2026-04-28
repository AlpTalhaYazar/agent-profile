/**
 * @module renderer
 *
 * Placeholder Renderer for Phase 2 Foundation.
 *
 * Real screens (Profile Explorer, Editor, Auth Vault, Session Monitor,
 * Provenance Inspector, Persona Composer — see `docs/05-gui-spec.md`) land in
 * later milestones. This sprint only verifies that:
 *
 *   - The hardened BrowserWindow loads.
 *   - `window.myclaude.version()` round-trips through preload + Main +
 *     `system.version` and renders.
 *
 * No styling, no shadcn, no Jotai — those land alongside the Profile Explorer.
 */
import * as React from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    myclaude?: {
      version: () => Promise<string>;
    };
  }
}

function App(): React.ReactElement {
  const [version, setVersion] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const v = (await window.myclaude?.version()) ?? "unknown";
      if (!cancelled) setVersion(v);
    })().catch(() => {
      if (!cancelled) setVersion("unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1 style={{ marginBottom: 8 }}>Agent Profile — Phase 2 scaffold</h1>
      <p>
        Renderer is intentionally minimal in this sprint. Real screens land in later milestones;
        this view only confirms the Main ↔ preload bridge round-trips.
      </p>
      <p>
        <strong>App version:</strong> {version ?? "loading…"}
      </p>
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
