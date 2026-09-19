// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { createUser, newTest } from "./helpers";

it("convex-test boots against the real schema and creates a signed-in identity", async () => {
  const t = newTest();
  const alice = await createUser(t, "alice@example.com");

  const stored = await t.run(async (ctx) => await ctx.db.get("users", alice.userId));

  expect(stored?.email).toBe("alice@example.com");
});
