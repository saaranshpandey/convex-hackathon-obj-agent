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

describe("a connection only counts in the mode it was made in", () => {
  it("a demo connection is not connected once eBay is in sandbox mode", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    await alice.as.mutation(api.ebayAuth.connect, {});
    expect((await alice.as.query(api.ebayAuth.connectionStatus, {})).connected).toBe(true);

    process.env.EBAY_MODE = "sandbox";
    try {
      const status = await alice.as.query(api.ebayAuth.connectionStatus, {});
      expect(status.connected).toBe(false);
      expect(status.mode).toBeNull();
    } finally {
      delete process.env.EBAY_MODE;
    }
  });

  it("publishing refuses a demo connection in sandbox mode instead of sending its fake token", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["x"])));
    await t.run(async (ctx) => {
      await ctx.db.patch("cleanouts", cleanoutId, { imageStorageId: storageId });
    });
    const listingId = await seedListing(t, cleanoutId, await seedItem(t, cleanoutId), "publishing");
    await alice.as.mutation(api.ebayAuth.connect, {});

    process.env.EBAY_MODE = "sandbox";
    try {
      await t.action(internal.listingPublish.publishOne, { listingId, userId: alice.userId });
    } finally {
      delete process.env.EBAY_MODE;
    }

    const listing = await t.run(async (ctx) => await ctx.db.get("listings", listingId));
    expect(listing?.status).toBe("failed");
    expect(listing?.publishError).toBe("Connect your eBay account before publishing.");
  });
});

describe("eBay OAuth state is a one-time code", () => {
  it("works once and then is gone", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const nonce = await t.run(async (ctx) => await issueOauthState(ctx, alice.userId));

    const first = await t.mutation(internal.ebayAuth.consumeState, { nonce });
    const second = await t.mutation(internal.ebayAuth.consumeState, { nonce });

    expect(first).toEqual({ userId: alice.userId, postalCode: null });
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

describe("the seller's ZIP code", () => {
  const sandboxEnv = () => {
    process.env.EBAY_MODE = "sandbox";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_RU_NAME = "ru-name";
  };
  const clearSandboxEnv = () => {
    delete process.env.EBAY_MODE;
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_RU_NAME;
  };

  it("connect in sandbox mode requires a valid ZIP", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");

    sandboxEnv();
    try {
      await expect(alice.as.mutation(api.ebayAuth.connect, {})).rejects.toThrow(
        "Enter a valid US ZIP code (for example 94105).",
      );
      await expect(
        alice.as.mutation(api.ebayAuth.connect, { postalCode: "abc" }),
      ).rejects.toThrow("Enter a valid US ZIP code (for example 94105).");

      const result = await alice.as.mutation(api.ebayAuth.connect, { postalCode: "94105" });
      expect(result.mode).toBe("sandbox");
      expect(result.authorizeUrl).toContain("auth.sandbox.ebay.com");
    } finally {
      clearSandboxEnv();
    }
  });

  it("the ZIP travels through the one-time code onto the connection", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const nonce = await t.run(async (ctx) => await issueOauthState(ctx, alice.userId, "94105"));

    const state = await t.mutation(internal.ebayAuth.consumeState, { nonce });
    expect(state).toEqual({ userId: alice.userId, postalCode: "94105" });

    await t.mutation(internal.ebayAuth.saveConnection, {
      userId: alice.userId,
      accessToken: "token",
      refreshToken: "refresh",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      mode: "sandbox",
      shipFromPostalCode: state?.postalCode ?? undefined,
    });

    sandboxEnv();
    try {
      const status = await alice.as.query(api.ebayAuth.connectionStatus, {});
      expect(status).toEqual({
        connected: true,
        mode: "sandbox",
        configuredMode: "sandbox",
        shipFromPostalCode: "94105",
      });
    } finally {
      clearSandboxEnv();
    }
  });

  it("a sandbox connection without a ZIP counts as not connected", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    await t.mutation(internal.ebayAuth.saveConnection, {
      userId: alice.userId,
      accessToken: "token",
      refreshToken: "refresh",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      mode: "sandbox",
    });

    sandboxEnv();
    try {
      const status = await alice.as.query(api.ebayAuth.connectionStatus, {});
      expect(status.connected).toBe(false);
      expect(status.configuredMode).toBe("sandbox");
    } finally {
      clearSandboxEnv();
    }
  });

  it("remembers a seller's setup IDs on their connection", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    await t.mutation(internal.ebayAuth.saveConnection, {
      userId: alice.userId,
      accessToken: "token",
      refreshToken: "refresh",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      mode: "sandbox",
      shipFromPostalCode: "94105",
    });

    await t.mutation(internal.ebayAuth.saveSellerSetup, {
      userId: alice.userId,
      sellerSetup: {
        locationKey: "roomsale-94105",
        fulfillmentPolicyId: "F1",
        paymentPolicyId: "P1",
        returnPolicyId: "R1",
      },
    });

    const connection = await t.query(internal.ebayAuth.connectionForUser, { userId: alice.userId });
    expect(connection?.sellerSetup?.fulfillmentPolicyId).toBe("F1");
    expect(connection?.shipFromPostalCode).toBe("94105");
  });
});

describe("publishing in sandbox mode needs the seller's ZIP", () => {
  it("fails with a clear message when the connection has no ZIP", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");
    const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["x"])));
    await t.run(async (ctx) => {
      await ctx.db.patch("cleanouts", cleanoutId, { imageStorageId: storageId });
      const now = Date.now();
      await ctx.db.insert("ebayConnections", {
        userId: alice.userId,
        accessToken: "token",
        refreshToken: "refresh",
        accessTokenExpiresAt: now + 3_600_000,
        mode: "sandbox",
        connectedAt: now,
        updatedAt: now,
      });
    });
    const listingId = await seedListing(t, cleanoutId, await seedItem(t, cleanoutId), "publishing");

    process.env.EBAY_MODE = "sandbox";
    try {
      await t.action(internal.listingPublish.publishOne, { listingId, userId: alice.userId });
    } finally {
      delete process.env.EBAY_MODE;
    }

    const listing = await t.run(async (ctx) => await ctx.db.get("listings", listingId));
    expect(listing?.status).toBe("failed");
    expect(listing?.publishError).toBe(
      "Reconnect eBay and enter your ZIP code — it's needed to set up your shipping location.",
    );
  });
});

describe("production mode", () => {
  it("connect in production mode sends the seller to eBay's production consent page", async () => {
    const t = newTest();
    const alice = await createUser(t, "alice@example.com");

    process.env.EBAY_MODE = "production";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_RU_NAME = "ru-name";
    try {
      const result = await alice.as.mutation(api.ebayAuth.connect, { postalCode: "94105" });

      expect(result.mode).toBe("production");
      expect(result.authorizeUrl).toContain("https://auth.ebay.com/oauth2/authorize");
      expect(result.authorizeUrl).not.toContain("sandbox");
    } finally {
      delete process.env.EBAY_MODE;
      delete process.env.EBAY_CLIENT_ID;
      delete process.env.EBAY_RU_NAME;
    }
  });
});
