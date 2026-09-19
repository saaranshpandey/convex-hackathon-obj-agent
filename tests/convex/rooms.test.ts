// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { createUser, newTest, seedItem, seedListing } from "./helpers";

describe("rooms are private to their owner", () => {
  it("a signed-out caller cannot start a room or get an upload URL", async () => {
    const t = newTest();

    await expect(t.mutation(api.cleanouts.start, { title: "Room" })).rejects.toThrow(
      "Sign in required",
    );
    await expect(t.mutation(api.cleanouts.generateUploadUrl, {})).rejects.toThrow(
      "Sign in required",
    );
  });

  it("latestForUser returns only the caller's own newest room", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");

    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });

    const mine = await alice.as.query(api.cleanouts.latestForUser, {});
    expect(mine?.cleanout._id).toBe(cleanoutId);
    expect(await bob.as.query(api.cleanouts.latestForUser, {})).toBeNull();
  });

  it("another user cannot touch someone else's room", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["x"])));

    await expect(
      bob.as.mutation(api.cleanouts.attachImage, { cleanoutId, storageId }),
    ).rejects.toThrow("Not found");
    await expect(
      bob.as.mutation(api.cleanouts.markUploadFailed, { cleanoutId, error: "x" }),
    ).rejects.toThrow("Not found");
    await expect(bob.as.mutation(api.cleanouts.retryAnalysis, { cleanoutId })).rejects.toThrow(
      "Not found",
    );
    await expect(
      bob.as.mutation(api.items.setAll, { cleanoutId, selected: true }),
    ).rejects.toThrow("Not found");
    await expect(
      bob.as.mutation(api.items.addManual, {
        cleanoutId,
        name: "Lamp",
        boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      }),
    ).rejects.toThrow("Not found");
    await expect(bob.as.mutation(api.research.startResearch, { cleanoutId })).rejects.toThrow(
      "Not found",
    );
    await expect(bob.as.query(api.activity.list, { cleanoutId })).rejects.toThrow("Not found");
  });

  it("another user cannot toggle, rename or remove someone else's item, but the owner can", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    const itemId = await seedItem(t, cleanoutId);

    await expect(bob.as.mutation(api.items.toggle, { itemId })).rejects.toThrow("Not found");
    await expect(bob.as.mutation(api.items.rename, { itemId, name: "Mine now" })).rejects.toThrow(
      "Not found",
    );
    await expect(bob.as.mutation(api.items.remove, { itemId })).rejects.toThrow("Not found");

    await alice.as.mutation(api.items.toggle, { itemId });
    const item = await t.run(async (ctx) => await ctx.db.get("items", itemId));
    expect(item?.selected).toBe(false);
  });

  it("another user cannot edit or approve someone else's listing, but the owner can", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    const itemId = await seedItem(t, cleanoutId);
    const listingId = await seedListing(t, cleanoutId, itemId);
    const fields = {
      listingId,
      title: "Lamp",
      description: "A lamp",
      category: "Home",
      condition: "good" as const,
      price: 45,
    };

    await expect(bob.as.mutation(api.listings.update, fields)).rejects.toThrow("Not found");
    await expect(bob.as.mutation(api.listings.approve, fields)).rejects.toThrow("Not found");

    await alice.as.mutation(api.listings.approve, fields);
    const listing = await t.run(async (ctx) => await ctx.db.get("listings", listingId));
    expect(listing?.status).toBe("approved");
    expect(listing?.price).toBe(45);
  });

  it("resetDemoData deletes only the caller's own rooms", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    await bob.as.mutation(api.cleanouts.start, { title: "Bob room" });

    await alice.as.mutation(api.dev.resetDemoData, {});

    expect(await alice.as.query(api.cleanouts.latestForUser, {})).toBeNull();
    expect((await bob.as.query(api.cleanouts.latestForUser, {}))?.cleanout.title).toBe("Bob room");
  });
});
