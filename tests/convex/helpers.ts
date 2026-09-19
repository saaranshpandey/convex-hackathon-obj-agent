/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import type { Doc, Id } from "../../convex/_generated/dataModel";

const modules = import.meta.glob("../../convex/**/*.*s");

export type TestConvex = ReturnType<typeof newTest>;

export function newTest() {
  return convexTest(schema, modules);
}

/** Convex Auth identifies a caller by a token subject of `<userId>|<sessionId>`. */
export async function createUser(t: TestConvex, email: string) {
  const userId = await t.run(async (ctx) => await ctx.db.insert("users", { email }));
  return { userId, as: t.withIdentity({ subject: `${userId}|test-session` }) };
}

export async function seedItem(t: TestConvex, cleanoutId: Id<"cleanouts">) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("items", {
        cleanoutId,
        name: "Lamp",
        category: "home",
        selected: true,
        confidence: 0.9,
        polygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.3, y: 0.1 },
          { x: 0.3, y: 0.3 },
          { x: 0.1, y: 0.3 },
        ],
        detectionBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        source: "detected",
        maskStatus: "failed",
        status: "detected",
        createdAt: Date.now(),
      }),
  );
}

export async function seedListing(
  t: TestConvex,
  cleanoutId: Id<"cleanouts">,
  itemId: Id<"items">,
  status: Doc<"listings">["status"] = "draft",
) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("listings", {
        cleanoutId,
        itemId,
        marketplace: "ebay",
        title: "Lamp",
        description: "A lamp",
        category: "Home",
        condition: "good",
        price: 40,
        status,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
  );
}

export async function seedOffer(
  t: TestConvex,
  listingId: Id<"listings">,
  status: Doc<"offers">["status"] = "pending",
) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("offers", {
        listingId,
        marketplaceOfferId: `OFFER-${Math.random().toString(36).slice(2, 10)}`,
        amount: 30,
        currency: "USD",
        status,
        source: "mock",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
  );
}
