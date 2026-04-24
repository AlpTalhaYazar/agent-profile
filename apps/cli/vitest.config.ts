import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "**/*.d.ts",
        // editor.ts spawns external processes — untestable in unit tests
        "src/utils/editor.ts",
        // profile/edit.ts orchestrates editor.ts — untestable without a real $EDITOR
        "src/commands/profile/edit.ts",
        // profile/index.ts is a pure re-export barrel — no logic to cover
        "src/commands/profile/index.ts",
        // auth/index.ts is a pure re-export barrel — no logic to cover
        "src/commands/auth/index.ts",
        // version.ts contains tsup-injected build-time constants (__CLI_VERSION__,
        // __CORE_VERSION__) that are only defined in bundled builds and cannot be
        // exercised in unit tests — the branches that check `typeof __X__ !== "undefined"`
        // are permanently false at test time.
        "src/commands/version.ts",
      ],
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
      },
    },
  },
});
