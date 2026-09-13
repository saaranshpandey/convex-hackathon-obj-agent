export class EbayError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "EbayError";
    this.status = status;
  }
}

/** This app only ever targets sandbox — "production" exists so the code
 * isn't hardcoded to one host, not because this build supports going live. */
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

export type PublishInput = {
  accessToken: string;
  env: EbayEnv;
  merchantLocationKey?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  categoryId?: string;
  listing: {
    sku: string;
    title: string;
    description: string;
    price: number;
    condition: "new" | "like_new" | "good" | "fair" | "poor";
    imageUrl: string;
    /** From Phase 4 identification, when known — many categories require a
     * Brand item aspect before they'll let an offer publish. */
    brand?: string | null;
    /** A short category-agnostic guess (Phase 4's identified category) for
     * the "Type" aspect some categories also require. */
    itemType?: string | null;
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
