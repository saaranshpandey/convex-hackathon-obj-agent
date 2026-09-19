// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { issueOauthState } from "../../convex/ebay/oauthState";
import { createUser, newTest, seedItem, seedListing } from "./helpers";

describe("eBay connection is per user", () => {
  it("connect, status and disconnect only ever touch the caller's own connection", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const bob = await createUser(t, "bob@example.com");

    await alice.as.mutation(api.ebayAuth.connect, {});

    expect((await alice.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(true);
    expect((await bob.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(false);

    await bob.as.mutation(api.ebayAuth.disconnect, {});
    expect((await alice.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(true);

    await expect(t.mutation(api.ebayAuth.connect, {})).rejects.toThrow("Sign in required");
  });
});

describe("eBay OAuth state is a one-time code", () => {
  it("works once and then is gone", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const nonce = await t.run(async (ctx) => await issueOauthState(ctx, alice.userId));

    const first = await t.mutation(internal.ebayAuth.consumeState, { nonce });
    const second = await t.mutation(internal.ebayAuth.consumeState, { nonce });

    expect(first).toBe(alice.userId);
    expect(second).toBeNull();
  });

  it("rejects an unknown code", async () => {
    const t = newTest();

    expect(await t.mutation(internal.ebayAuth.consumeState, { nonce: "not-a-real-code" })).toBeNull();
  });

  it("rejects an expired code", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("ebayOauthStates", {
        nonce: "old-code",
        userId: alice.userId,
        expiresAt: Date.now() - 1,
      });
    });

    expect(await t.mutation(internal.ebayAuth.consumeState, { nonce: "old-code" })).toBeNull();
  });
});

describe("publishing is private to the listing owner", () => {
  it("another user cannot publish someone else's listing, but the owner can", async () => {
    // Publishing schedules a background job; fake timers keep it from running mid-test.
    vi.useFakeTimers();
    try {
      const t = newTest();
      const alice = await createUser(t, "alice@example.com");
      const bob = await createUser(t, "bob@example.com");
      const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
      const itemId = await seedItem(t, cleanoutId);
      const listingId = await seedListing(t, cleanoutId, itemId, "approved");

      await expect(bob.as.mutation(api.listingPublish.publish, { listingId })).rejects.toThrow(
        "Not found",
      );
      await expect(
        bob.as.mutation(api.listingPublish.publishApproved, { cleanoutId }),
      ).rejects.toThrow("Not found");

      await alice.as.mutation(api.listingPublish.publish, { listingId });
      const listing = await t.run(async (ctx) => await ctx.db.get("listings", listingId));
      expect(listing?.status).toBe("publishing");
    } finally {
      vi.useRealTimers();
    }
  });
});
