// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { DEMO_ITEMS } from "../../convex/demoData";
import { createUser, newTest, seedItem } from "./helpers";

afterEach(() => vi.useRealTimers());

it("processes demo items together and prevents duplicate research batches", async () => {
  vi.useFakeTimers();
  const t = newTest();
  const owner = await createUser(t, "preparation@example.com");
  const cleanoutId = await owner.as.mutation(api.cleanouts.start, { title: "Preparation" });
  const first = await seedItem(t, cleanoutId);
  const second = await seedItem(t, cleanoutId);
  await t.run(async (ctx) => {
    await ctx.db.patch("cleanouts", cleanoutId, { isDemo: true });
    for (const id of [first, second]) await ctx.db.patch("items", id, { name: DEMO_ITEMS[0].name });
  });
  await owner.as.mutation(api.research.startResearch, { cleanoutId });
  await owner.as.mutation(api.research.startResearch, { cleanoutId });
  const scheduled = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled).toHaveLength(1);
  const args = { cleanoutId, itemIds: [first, second] };
  await t.mutation(internal.demo.simulateResearch, args);
  const states = () => t.run(async (ctx) => Promise.all([first, second].map((id) => ctx.db.get("items", id))));
  expect((await states()).map((item) => item?.researchStatus)).toEqual(["identifying", "identifying"]);
  await t.mutation(internal.demo.applyIdentification, args);
  expect((await states()).map((item) => item?.researchStatus)).toEqual(["researching", "researching"]);
  await t.mutation(internal.demo.applyPricing, args);
  const priced = await states();
  expect(priced.map((item) => item?.researchStatus)).toEqual(["ready_for_review", "ready_for_review"]);
  expect(priced[0]?.estimatedLow).toBe(DEMO_ITEMS[0].estimatedLow);
  expect(priced[1]?.estimatedLow).toBe(DEMO_ITEMS[0].estimatedLow);
  await t.mutation(internal.demo.draftListings, args);
  const drafts = await t.run(async (ctx) => await ctx.db.query("listings").collect());
  expect(drafts.map((draft) => draft.itemId)).toEqual([first, second]);
});
