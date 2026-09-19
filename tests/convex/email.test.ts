// @vitest-environment edge-runtime
import { expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { createUser, newTest, seedItem, seedListing } from "./helpers";

it("a listing's email context carries its owner's email, and only that owner's", async () => {
  const t = newTest();
  const alice = await createUser(t, "alice@example.com");
  const bob = await createUser(t, "bob@example.com");
  const aliceRoom = await alice.as.mutation(api.cleanouts.start, { title: "Alice room" });
  const bobRoom = await bob.as.mutation(api.cleanouts.start, { title: "Bob room" });
  const aliceListing = await seedListing(t, aliceRoom, await seedItem(t, aliceRoom), "live");
  const bobListing = await seedListing(t, bobRoom, await seedItem(t, bobRoom), "live");

  const forAlice = await t.query(internal.agentMail.contextForListing, {
    listingId: aliceListing,
  });
  const forBob = await t.query(internal.agentMail.contextForListing, { listingId: bobListing });

  expect(forAlice?.ownerEmail).toBe("alice@example.com");
  expect(forBob?.ownerEmail).toBe("bob@example.com");
  expect(
    await t.query(internal.agentMail.ownerEmailForListing, { listingId: aliceListing }),
  ).toBe("alice@example.com");
});
