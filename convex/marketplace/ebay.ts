/**
 * Real eBay Best Offer adapter (Trading API).
 *
 * ⚠️ UNVERIFIED NETWORK PATH ⚠️
 * Every fetch in this file is written from eBay's documentation and has never
 * been executed against a live account — we have no eBay credentials, and even
 * with them a Best Offer needs a second sandbox buyer account to place one.
 * The XML it produces and consumes IS covered by fixture tests
 * (`tests/marketplace/ebayXml.test.ts`); the transport is not.
 *
 * Buyer-initiated Best Offers are Trading-API-only. The REST Sell APIs don't
 * expose them, and the REST Negotiation API is seller→buyer discount offers,
 * which is a different feature.
 */

import { MarketplaceError, type MarketplaceProvider } from "./types";
import {
  TRADING_API_VERSION,
  buildGetBestOffers,
  buildGetItem,
  buildRespondToBestOffer,
  parseGetBestOffers,
  parseGetItemSaleStatus,
  parseRespondToBestOffer,
} from "./ebayXml";

type TradingCall = "GetBestOffers" | "RespondToBestOffer" | "GetItem";

const SANDBOX_ENDPOINT = "https://api.sandbox.ebay.com/ws/api.dll";

/** eBay US. */
const SITE_ID = "0";

async function tradingRequest(
  call: TradingCall,
  accessToken: string,
  body: string,
): Promise<string> {
  const response = await fetch(SANDBOX_ENDPOINT, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": call,
      "X-EBAY-API-SITEID": SITE_ID,
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      // The OAuth access token from Phase 6's connection goes here rather than
      // in RequesterCredentials.
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml",
    },
    body,
  });

  const text = await response.text();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MarketplaceError(
        "eBay rejected the access token. Reconnect your eBay account.",
        response.status,
      );
    }
    throw new MarketplaceError(
      `eBay ${call} failed (${response.status}): ${text.slice(0, 300)}`,
      response.status,
    );
  }

  return text;
}

export function createEbayProvider(): MarketplaceProvider {
  return {
    name: "ebay",

    async getOffers({ listingId, accessToken }) {
      const xml = await tradingRequest(
        "GetBestOffers",
        accessToken,
        buildGetBestOffers(null, listingId),
      );
      return parseGetBestOffers(xml);
    },

    async respondToOffer({ listingId, marketplaceOfferId, action, amount, accessToken }) {
      if (action === "counter" && (amount === undefined || !Number.isFinite(amount) || amount <= 0)) {
        throw new MarketplaceError("A counter needs a valid amount.");
      }

      const xml = await tradingRequest(
        "RespondToBestOffer",
        accessToken,
        buildRespondToBestOffer(null, {
          itemId: listingId,
          bestOfferId: marketplaceOfferId,
          action,
          counterAmount: amount,
        }),
      );
      parseRespondToBestOffer(xml);
    },

    async getListingStatus({ listingId, accessToken }) {
      const xml = await tradingRequest("GetItem", accessToken, buildGetItem(null, listingId));
      return parseGetItemSaleStatus(xml);
    },
  };
}
