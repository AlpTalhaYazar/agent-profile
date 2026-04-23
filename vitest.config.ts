import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/index.ts", "**/*.d.ts"],
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
      },
    },
  },
});
