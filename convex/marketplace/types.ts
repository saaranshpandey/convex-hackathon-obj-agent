/**
 * Provider-neutral marketplace activity contract.
 *
 * Scope is deliberately the selling loop only — offer received, accept,
 * decline, counter, buyer accepts, sold. No traffic or watcher analytics.
 *
 * Nothing outside `convex/marketplace/` knows whether an offer came from the
 * mock provider or from eBay.
 */

export type OfferStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "countered"
  | "buyer_accepted"
  | "expired";

export type OfferSource = "mock" | "ebay";

/** One offer, normalised away from any marketplace's wire format. */
export type MarketplaceOffer = {
  marketplaceOfferId: string;
  amount: number;
  currency: string;
  status: OfferStatus;
  /** Present once the seller has countered. */
  counterAmount?: number;
  buyerMessage?: string;
};

export type OfferAction = "accept" | "decline" | "counter";

export type ListingSaleStatus = {
  sold: boolean;
  /** The price it actually sold at, when known. */
  soldPrice?: number;
};

export interface MarketplaceProvider {
  readonly name: OfferSource;

  getOffers(input: {
    listingId: string;
    accessToken: string;
  }): Promise<MarketplaceOffer[]>;

  respondToOffer(input: {
    listingId: string;
    marketplaceOfferId: string;
    action: OfferAction;
    /** Required when action is "counter". */
    amount?: number;
    accessToken: string;
  }): Promise<void>;

  getListingStatus(input: {
    listingId: string;
    accessToken: string;
  }): Promise<ListingSaleStatus>;
}

/** Raised for conditions worth showing the owner verbatim. */
export class MarketplaceError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MarketplaceError";
    this.status = status;
  }
}
