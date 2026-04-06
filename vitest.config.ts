import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // e2e/integration: integration tests against a real Postgres (slow)
    // src/**/*.test.ts: unit tests colocated with source files (fast, mocked)
    include: ["e2e/integration/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
