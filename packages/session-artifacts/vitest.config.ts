import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/types.ts", "**/*.d.ts"],
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
      },
    },
  },
});
