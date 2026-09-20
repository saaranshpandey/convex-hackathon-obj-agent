/**
 * Real eBay Sell Inventory API flow: createOrReplaceInventoryItem, then
 * createOffer, then publishOffer. The seller's location and policies, the
 * category, the condition and the item details are resolved by the caller
 * (see ebay/sellerSetup.ts and ebay/prepare.ts); this file only talks to the
 * Inventory API.
 */

import { ebayRequest } from "./http";
import { EbayError, type EbayEnv, type EbayPublisher } from "./types";

const RETRY_DELAYS_MS = [1_000, 3_000];

/** eBay's own server errors are theirs, not ours, and replacing an item is safe to repeat. */
async function retryServerErrors<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const serverError = error instanceof EbayError && error.status !== undefined && error.status >= 500;
      if (!serverError || attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

export function createSandboxPublisher(env: EbayEnv): EbayPublisher {
  return {
    name: env,
    async publish(input) {
      const {
        categoryId,
        merchantLocationKey,
        fulfillmentPolicyId,
        paymentPolicyId,
        returnPolicyId,
      } = input;
      const { ebayCondition, aspects } = input.listing;
      if (
        !categoryId ||
        !merchantLocationKey ||
        !fulfillmentPolicyId ||
        !paymentPolicyId ||
        !returnPolicyId ||
        !ebayCondition ||
        !aspects
      ) {
        throw new EbayError(
          "The eBay publisher was called without a category, seller setup, condition or item details.",
        );
      }

      const sku = input.listing.sku;

      const putInventoryItem = async (condition: string) => {
        const body = {
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
        };

        try {
          await retryServerErrors(() =>
            ebayRequest(env, input.accessToken, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, body),
          );
        } catch (error) {
          // eBay's reply says little about which field it choked on, so keep what we sent.
          console.log(`eBay inventory item save failed for ${sku} on ${env}: ${JSON.stringify(body)}`);
          throw error;
        }
      };

      await putInventoryItem(ebayCondition);

      let offerId: string;
      try {
        const offer = await ebayRequest(env, input.accessToken, "POST", "/sell/inventory/v1/offer", {
          sku,
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          availableQuantity: 1,
          categoryId,
          listingDescription: input.listing.description,
          pricingSummary: { price: { value: String(input.listing.price), currency: "USD" } },
          listingPolicies: { fulfillmentPolicyId, paymentPolicyId, returnPolicyId },
          merchantLocationKey,
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
        // errorId 25021: the chosen condition isn't valid for this category.
        // The category lookup normally prevents this; retry once with plain
        // "Used", which every category we have seen accepts.
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
