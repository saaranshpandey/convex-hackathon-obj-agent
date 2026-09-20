export class EbayError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "EbayError";
    this.status = status;
  }
}

/** "sandbox" for development and testing, "production" for real sellers. */
export type EbayEnv = "sandbox" | "production";

export type EbayTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number | null;
};

export type EbayAccessToken = {
  accessToken: string;
  accessTokenExpiresAt: number;
};

export type ListingCondition = "new" | "like_new" | "good" | "fair" | "poor";

/** IDs of a seller's own shipping location and business policies. */
export type SellerSetup = {
  locationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
};

export type PublishInput = {
  accessToken: string;
  env: EbayEnv;
  categoryId?: string;
  merchantLocationKey?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  listing: {
    sku: string;
    title: string;
    description: string;
    price: number;
    imageUrl: string;
    /** Already-resolved eBay condition enum for this category. */
    ebayCondition?: string;
    /** Already-resolved required item details for this category. */
    aspects?: Record<string, string[]>;
  };
};

export type PublishResult = {
  ebayListingId: string;
  ebayOfferId: string;
  ebayListingUrl: string;
};

export interface EbayPublisher {
  readonly name: string;
  publish(input: PublishInput): Promise<PublishResult>;
}
