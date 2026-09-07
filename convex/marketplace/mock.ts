import type { MarketplaceProvider } from "./types";

/**
 * The demo path, and the only one that works without eBay credentials.
 *
 * It deliberately holds no state. Offers live in Convex, and a simulated buyer
 * event is injected through the same `offers.ingest` mutation a real poll would
 * call — so the application path under test is the real one. All this provider
 * does is stand in for the network calls that would otherwise leave the box.
 */
export function createMockProvider(): MarketplaceProvider {
  return {
    name: "mock",

    // Convex is the source of truth for simulated offers; there is no remote
    // marketplace to poll.
    async getOffers() {
      return [];
    },

    // Succeeds immediately. The resulting state change is applied in Convex by
    // the shared decision path, exactly as it is for a real response.
    async respondToOffer() {
      return;
    },

    // Sale status is driven by the simulated buyer, not by a remote lookup.
    async getListingStatus() {
      return { sold: false };
    },
  };
}
