import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // e2e/integration: integration tests against a real Postgres (slow)
    // src/**/*.test.ts: unit tests colocated with source files (fast, mocked)
    // __tests__/api: route handler tests with mocked deps (fast)
    include: [
      "e2e/integration/**/*.test.ts",
      "src/**/*.test.{ts,tsx}",
      "__tests__/**/*.test.{ts,tsx}",
    ],
    testTimeout: 30000,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@veridian/shared": path.resolve(__dirname, "./shared/shared/index.ts"),
    },
  },
});
