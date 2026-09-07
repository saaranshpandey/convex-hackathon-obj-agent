import type { EbayPublisher } from "./types";

/** No network calls — a believable delay and a clearly-fake listing ID/URL. */
export function createMockPublisher(): EbayPublisher {
  return {
    name: "mock",
    async publish() {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const fakeId = `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      return {
        ebayListingId: fakeId,
        ebayOfferId: `OFFER-${fakeId}`,
        ebayListingUrl: `https://www.ebay.com/itm/mock-${fakeId.toLowerCase()}`,
      };
    },
  };
}
