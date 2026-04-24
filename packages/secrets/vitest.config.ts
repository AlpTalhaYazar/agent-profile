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
        // Re-export barrel files (no logic to test)
        "src/index.ts",
        "src/backend/index.ts",
        "src/resolver/index.ts",
        // Pure type definition file (no executable code)
        "src/backend/types.ts",
        // Wraps the real @napi-rs/keyring OS keychain — tested via MockBackend
        // in backend-keyring.test.ts; direct calls would touch the real keychain.
        "src/backend/keyring.ts",
        "**/*.d.ts",
      ],
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
      },
    },
  },
});
