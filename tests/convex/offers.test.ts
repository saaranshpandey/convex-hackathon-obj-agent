// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { createUser, newTest, seedItem, seedListing, seedOffer } from "./helpers";

async function aliceWithLiveListing() {
  const t = newTest();
  const alice = await createUser(t, "alice@example.com");
  const bob = await createUser(t, "bob@example.com");
  const cleanoutId = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
  const itemId = await seedItem(t, cleanoutId);
  const listingId = await seedListing(t, cleanoutId, itemId, "live");
  const offerId = await seedOffer(t, listingId);
  return { t, alice, bob, listingId, offerId };
}

describe("offers and the agent thread are private to the listing owner", () => {
  it("another user cannot read a listing's offers or messages, but the owner can", async () => {
    const { alice, bob, listingId } = await aliceWithLiveListing();

    await expect(bob.as.query(api.offers.listForListing, { listingId })).rejects.toThrow(
      "Not found",
    );
    await expect(bob.as.query(api.agentMail.messagesForListing, { listingId })).rejects.toThrow(
      "Not found",
    );

    const offers = await alice.as.query(api.offers.listForListing, { listingId });
    expect(offers).toHaveLength(1);
  });

  it("another user cannot decide on someone else's offer", async () => {
    const { bob, offerId } = await aliceWithLiveListing();

    await expect(
      bob.as.action(api.offers.decide, { offerId, action: "accept" }),
    ).rejects.toThrow("Not found");
  });

  it("a signed-out caller cannot decide on an offer", async () => {
    const { t, offerId } = await aliceWithLiveListing();

    await expect(t.action(api.offers.decide, { offerId, action: "accept" })).rejects.toThrow(
      "Sign in required",
    );
  });

  it("another user cannot simulate offers on someone else's listing", async () => {
    const { bob, listingId, offerId } = await aliceWithLiveListing();

    await expect(
      bob.as.mutation(api.offers.simulateBuyerOffer, { listingId, amount: 20 }),
    ).rejects.toThrow("Not found");
    await expect(
      bob.as.mutation(api.offers.simulateBuyerAcceptsCounter, { offerId }),
    ).rejects.toThrow("Not found");
  });
});
