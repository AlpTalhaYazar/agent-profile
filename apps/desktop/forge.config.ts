/**
 * Electron Forge configuration for `@agent-profile/desktop`.
 *
 * Two plugins are wired here:
 *
 *  - `@electron-forge/plugin-vite` — bundles the Main process, preload, and the
 *    placeholder Renderer through Vite. The entries reflect the source layout
 *    in `src/main`, `src/preload`, and `src/renderer`.
 *  - `@electron-forge/plugin-fuses` — flips Electron Fuses at package time so
 *    the shipped binary cannot be repurposed as a generic Node runtime nor
 *    accept `--inspect` from a malicious caller. The fuse values match
 *    `docs/06-security.md` "Electron Fuses" exactly. They are re-verified at
 *    build time by `scripts/verify-fuses.mjs`.
 */
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "AgentProfile",
  },
  rebuildConfig: {},
  makers: [],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          // Dedicated preload for the Main-owned secret-entry child window.
          // Phase 2 milestone 5 hybrid plaintext flow: `auth.add` opens this
          // modal so the Anthropic API key never crosses the Renderer.
          entry: "src/secret-dialog/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    // The fuse values below mirror the table in `docs/06-security.md`.
    // CI runs `scripts/verify-fuses.mjs` against the packaged binary to confirm
    // the bits actually flipped — these declarations are the source of truth.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
