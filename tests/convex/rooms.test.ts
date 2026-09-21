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

  it("workspace defaults to the caller's own newest room", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");

    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });

    const mine = await alice.as.query(api.cleanouts.workspace, {});
    expect(mine?.cleanout._id).toBe(cleanoutId);
    expect(await bob.as.query(api.cleanouts.workspace, {})).toBeNull();
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

    expect(await alice.as.query(api.cleanouts.workspace, {})).toBeNull();
    expect((await bob.as.query(api.cleanouts.workspace, {}))?.cleanout.title).toBe("Bob room");
  });
});

describe("the room rail", () => {
  it("lists only the caller's own rooms, newest first", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");

    const first = await alice.as.mutation(api.cleanouts.start, { title: "Living room" });
    const second = await alice.as.mutation(api.cleanouts.start, { title: "Garage" });
    await bob.as.mutation(api.cleanouts.start, { title: "Bob room" });

    const rooms = await alice.as.query(api.cleanouts.list, {});
    expect(rooms.map((room) => room._id)).toEqual([second, first]);
    expect(rooms.map((room) => room.title)).toEqual(["Garage", "Living room"]);

    expect((await bob.as.query(api.cleanouts.list, {})).map((room) => room.title)).toEqual([
      "Bob room",
    ]);
    await expect(t.query(api.cleanouts.list, {})).rejects.toThrow("Sign in required");
  });

  it("tallies each room's items and listings without returning them", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Living room" });
    const itemId = await seedItem(t, cleanoutId);
    const second = await seedItem(t, cleanoutId);
    await t.run(async (ctx) => await ctx.db.patch("items", second, { selected: false }));
    await seedListing(t, cleanoutId, itemId, "live");
    await seedListing(t, cleanoutId, second, "live");
    await seedListing(t, cleanoutId, itemId, "draft");

    const [room] = await alice.as.query(api.cleanouts.list, {});
    expect(room.itemCount).toBe(2);
    expect(room.selectedCount).toBe(1);
    expect(room.researching).toBe(false);
    expect(room.listings).toEqual({
      reviewable: 1,
      publishing: 0,
      live: 2,
      sold: 0,
      ended: 0,
    });
  });

  it("flags a room whose items are still being researched", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Living room" });
    const itemId = await seedItem(t, cleanoutId);
    await t.run(
      async (ctx) => await ctx.db.patch("items", itemId, { researchStatus: "researching" }),
    );

    expect((await alice.as.query(api.cleanouts.list, {}))[0].researching).toBe(true);
  });

  it("opens a specific room by id, but never someone else's", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const older = await alice.as.mutation(api.cleanouts.start, { title: "Living room" });
    await alice.as.mutation(api.cleanouts.start, { title: "Garage" });

    const opened = await alice.as.query(api.cleanouts.workspace, { cleanoutId: older });
    expect(opened?.cleanout.title).toBe("Living room");

    await expect(
      bob.as.query(api.cleanouts.workspace, { cleanoutId: older }),
    ).rejects.toThrow("Not found");
  });

  it("replaces a photo inside the same room instead of starting another", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Living room" });
    const first = await t.run(async (ctx) => await ctx.storage.store(new Blob(["one"])));
    await alice.as.mutation(api.cleanouts.attachImage, { cleanoutId, storageId: first });

    const itemId = await seedItem(t, cleanoutId);
    await seedListing(t, cleanoutId, itemId, "draft");

    const second = await t.run(async (ctx) => await ctx.storage.store(new Blob(["two"])));
    await alice.as.mutation(api.cleanouts.replaceImage, {
      cleanoutId,
      storageId: second,
      imageWidth: 800,
      imageHeight: 600,
    });

    // Same room, re-scanning the new photo, with the old derivations cleared.
    expect((await alice.as.query(api.cleanouts.list, {})).length).toBe(1);
    const opened = await alice.as.query(api.cleanouts.workspace, { cleanoutId });
    expect(opened?.cleanout.status).toBe("analyzing");
    expect(opened?.cleanout.imageStorageId).toBe(second);
    expect(opened?.cleanout.imageWidth).toBe(800);
    expect(opened?.items).toEqual([]);
    expect(opened?.listings).toEqual([]);
    // The old photo is not left behind in storage.
    expect(await t.run(async (ctx) => await ctx.storage.getUrl(first))).toBeNull();
  });

  it("refuses to swap the photo out from under a listing that reached eBay", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Living room" });
    const itemId = await seedItem(t, cleanoutId);
    const listingId = await seedListing(t, cleanoutId, itemId, "live");
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["x"])));

    await expect(
      alice.as.mutation(api.cleanouts.replaceImage, { cleanoutId, storageId }),
    ).rejects.toThrow("already has listings on eBay");
    await expect(
      bob.as.mutation(api.cleanouts.replaceImage, { cleanoutId, storageId }),
    ).rejects.toThrow("Not found");

    // Nothing was destroyed on the way to refusing.
    expect(await t.run(async (ctx) => await ctx.db.get("listings", listingId))).not.toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.get("items", itemId))).not.toBeNull();
  });

  it("stops treating a demo room as seeded once its photo is replaced", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Demo room" });
    await t.run(async (ctx) => await ctx.db.patch("cleanouts", cleanoutId, { isDemo: true }));
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["x"])));

    await alice.as.mutation(api.cleanouts.replaceImage, { cleanoutId, storageId });

    expect((await alice.as.query(api.cleanouts.list, {}))[0].isDemo).toBe(false);
  });

  it("renames a room for its owner only", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "IMG_4821" });

    await expect(
      bob.as.mutation(api.cleanouts.rename, { cleanoutId, title: "Mine now" }),
    ).rejects.toThrow("Not found");
    await expect(
      alice.as.mutation(api.cleanouts.rename, { cleanoutId, title: "   " }),
    ).rejects.toThrow("A room needs a name");

    await alice.as.mutation(api.cleanouts.rename, { cleanoutId, title: "  Living room  " });
    expect((await alice.as.query(api.cleanouts.list, {}))[0].title).toBe("Living room");
  });
});
