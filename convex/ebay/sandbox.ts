/**
 * Real eBay Sell Inventory API flow: createOrReplaceInventoryItem, then
 * createOffer, then publishOffer. Each stage's required fields (business
 * policies, merchant location, category) come from Convex env — this app
 * doesn't look them up dynamically, so a clear error names exactly what's
 * missing rather than failing deep inside an eBay request.
 */

import { EbayError, type EbayEnv, type EbayPublisher, type PublishInput } from "./types";
import { ebayRequest } from "./http";

const CONDITION_MAP: Record<PublishInput["listing"]["condition"], string> = {
  new: "NEW",
  like_new: "LIKE_NEW",
  good: "USED_GOOD",
  fair: "USED_ACCEPTABLE",
  poor: "USED_ACCEPTABLE",
};

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

      // Many categories reject a publish without Brand and Type item
      // aspects. Other category-specific aspects vary too widely to fill in
      // generically here — a missing one still surfaces as a clear error.
      const brand = input.listing.brand ?? "Unbranded";
      const itemType = input.listing.itemType ?? undefined;
      const aspects = itemType ? { Brand: [brand], Type: [itemType] } : { Brand: [brand] };

      const putInventoryItem = (condition: string) =>
        ebayRequest(env, input.accessToken, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
          condition,
          product: {
            title: input.listing.title,
            description: input.listing.description,
            imageUrls: [input.listing.imageUrl],
            aspects,
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

      await putInventoryItem(CONDITION_MAP[input.listing.condition]);

      let offerId: string;
      try {
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
        if (typeof offer.offerId !== "string") {
          throw new EbayError("eBay did not return an offer ID.");
        }
        offerId = offer.offerId;
      } catch (error) {
        // A prior attempt on this SKU got as far as creating an offer, then
        // failed at a later step — eBay reports the existing offerId in the
        // error itself, so reuse it instead of treating retry as impossible.
        const existingOfferId =
          error instanceof EbayError
            ? /"name":\s*"offerId",\s*"value":\s*"(\d+)"/.exec(error.message)?.[1]
            : undefined;
        if (!existingOfferId) throw error;
        offerId = existingOfferId;
      }

      const publishOffer = () =>
        ebayRequest(env, input.accessToken, "POST", `/sell/inventory/v1/offer/${offerId}/publish`);

      let published: Record<string, unknown>;
      try {
        published = await publishOffer();
      } catch (error) {
        // errorId 25021: the mapped condition isn't valid for this specific
        // category — allowed conditions vary a lot by category, with no
        // single cheap lookup that covers all of them. Retry once with a
        // condition value confirmed to be broadly accepted.
        if (error instanceof EbayError && /"errorId":\s*25021/.test(error.message)) {
          await putInventoryItem("USED_EXCELLENT");
          published = await publishOffer();
        } else {
          throw error;
        }
      }

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
