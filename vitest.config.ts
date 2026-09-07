import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the pure-TypeScript unit tests; Convex functions are exercised
    // against the real deployment rather than mocked here.
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
