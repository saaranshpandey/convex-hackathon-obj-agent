/**
 * Real eBay Sell Inventory API flow: createOrReplaceInventoryItem, then
 * createOffer, then publishOffer. Each stage's required fields (business
 * policies, merchant location, category) come from Convex env — this app
 * doesn't look them up dynamically, so a clear error names exactly what's
 * missing rather than failing deep inside an eBay request.
 */

import { EbayError, type EbayEnv, type EbayPublisher, type PublishInput } from "./types";

function apiBase(env: EbayEnv): string {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

const CONDITION_MAP: Record<PublishInput["listing"]["condition"], string> = {
  new: "NEW",
  like_new: "LIKE_NEW",
  good: "USED_GOOD",
  fair: "USED_ACCEPTABLE",
  poor: "USED_ACCEPTABLE",
};

async function ebayRequest(
  env: EbayEnv,
  accessToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401) {
      throw new EbayError("eBay rejected the access token. Reconnect your eBay account.", 401);
    }
    throw new EbayError(
      `eBay ${method} ${path} failed (${response.status}): ${detail.slice(0, 500)}`,
      response.status,
    );
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export function createSandboxPublisher(env: EbayEnv): EbayPublisher {
  return {
    name: env,
    async publish(input) {
      if (!input.merchantLocationKey) {
        throw new EbayError("EBAY_MERCHANT_LOCATION_KEY is not set in the Convex environment.");
      }
      if (!input.fulfillmentPolicyId || !input.paymentPolicyId || !input.returnPolicyId) {
        throw new EbayError(
          "EBAY_FULFILLMENT_POLICY_ID, EBAY_PAYMENT_POLICY_ID and EBAY_RETURN_POLICY_ID must all be set — create business policies in your eBay Seller Hub first.",
        );
      }
      if (!input.categoryId) {
        throw new EbayError("EBAY_CATEGORY_ID is not set in the Convex environment.");
      }

      const sku = input.listing.sku;

      await ebayRequest(env, input.accessToken, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
        condition: CONDITION_MAP[input.listing.condition],
        product: {
          title: input.listing.title,
          description: input.listing.description,
          imageUrls: [input.listing.imageUrl],
        },
        // No real package dimensions are known at this stage — a generic
        // small-parcel default so publish doesn't fail on a missing field.
        packageWeightAndSize: {
          weight: { value: 5, unit: "POUND" },
          dimensions: { length: 12, width: 12, height: 12, unit: "INCH" },
        },
        availability: {
          shipToLocationAvailability: { quantity: 1 },
        },
      });

      const offer = await ebayRequest(env, input.accessToken, "POST", "/sell/inventory/v1/offer", {
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        availableQuantity: 1,
        categoryId: input.categoryId,
        listingDescription: input.listing.description,
        pricingSummary: { price: { value: String(input.listing.price), currency: "USD" } },
        listingPolicies: {
          fulfillmentPolicyId: input.fulfillmentPolicyId,
          paymentPolicyId: input.paymentPolicyId,
          returnPolicyId: input.returnPolicyId,
        },
        merchantLocationKey: input.merchantLocationKey,
      });

      const offerId = offer.offerId;
      if (typeof offerId !== "string") {
        throw new EbayError("eBay did not return an offer ID.");
      }

      const published = await ebayRequest(
        env,
        input.accessToken,
        "POST",
        `/sell/inventory/v1/offer/${offerId}/publish`,
      );

      const listingId = published.listingId;
      if (typeof listingId !== "string") {
        throw new EbayError("eBay did not return a listing ID after publishing.");
      }

      const host = env === "production" ? "www.ebay.com" : "sandbox.ebay.com";
      return {
        ebayListingId: listingId,
        ebayOfferId: offerId,
        ebayListingUrl: `https://${host}/itm/${listingId}`,
      };
    },
  };
}
