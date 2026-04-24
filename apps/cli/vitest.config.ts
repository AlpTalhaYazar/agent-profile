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
      ],
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
      },
    },
  },
});
