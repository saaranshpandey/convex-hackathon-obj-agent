import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-TypeScript unit tests run in node. Convex-function tests live in
    // tests/convex and pick the edge runtime per file with a
    // `@vitest-environment edge-runtime` docblock.
    include: ["tests/**/*.test.ts"],
    environment: "node",
    server: { deps: { inline: ["convex-test"] } },
  },
});
