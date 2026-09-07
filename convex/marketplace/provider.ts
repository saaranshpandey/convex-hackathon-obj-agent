import { env } from "../_generated/server";
import { createMockProvider } from "./mock";
import { createEbayProvider } from "./ebay";
import type { MarketplaceProvider, OfferSource } from "./types";

export * from "./types";

/**
 * EBAY_ACTIVITY_MODE selects the source of marketplace activity. It is separate
 * from EBAY_MODE (which governs publishing) on purpose: you can publish to the
 * eBay sandbox while still driving offers from the simulator, which is the only
 * way to demo the loop given sandbox has no organic buyer traffic.
 *
 * Defaults to mock — an unset value must never break the demo.
 */
export function getActivityMode(): OfferSource {
  return env.EBAY_ACTIVITY_MODE?.trim().toLowerCase() === "ebay" ? "ebay" : "mock";
}

export function getMarketplaceProvider(): MarketplaceProvider {
  return getActivityMode() === "ebay" ? createEbayProvider() : createMockProvider();
}
