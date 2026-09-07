/**
 * eBay Trading API XML, in and out.
 *
 * Buyer-initiated Best Offers are Trading-API-only — the REST Sell APIs don't
 * expose them, and the REST Negotiation API is the opposite direction
 * (seller-initiated discounts to watchers). So this phase needs XML.
 *
 * Everything here is pure: no network, no Convex. That's what makes it
 * fixture-testable, which matters because the network path itself can't be
 * verified without eBay credentials.
 */

import { MarketplaceError, type MarketplaceOffer, type OfferStatus } from "./types";

export const TRADING_API_VERSION = "1451";

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

/** First value of `tag`, or null. Attributes on the tag are tolerated. */
export function tagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? match[1].trim() : null;
}

/** Every occurrence of `tag`, inner content only. */
export function tagBlocks(xml: string, tag: string): string[] {
  const matches = xml.matchAll(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"),
  );
  return [...matches].map((m) => m[1]);
}

/** currencyID="USD" on a price element. */
function currencyOf(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*currencyID="([^"]+)"`).exec(xml);
  return match ? match[1] : "USD";
}

/**
 * eBay's BestOfferStatus vocabulary, narrowed to ours.
 *
 * Anything unrecognised maps to "expired" — deliberately the non-actionable
 * state, so an eBay status we don't understand can never prompt the owner to
 * act on an offer that isn't really open.
 */
export function normalizeOfferStatus(raw: string | null): OfferStatus {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "pending":
    case "active":
      return "pending";
    case "accepted":
      return "accepted";
    case "declined":
    case "rejected":
      return "declined";
    case "countered":
      return "countered";
    default:
      return "expired";
  }
}

/** Throws when eBay reported a failure; otherwise returns. */
export function assertAckOk(xml: string): void {
  const ack = tagText(xml, "Ack");
  if (ack === null) {
    throw new MarketplaceError("eBay returned a response with no Ack element.");
  }
  if (ack === "Success" || ack === "Warning") return;

  const short = tagText(xml, "ShortMessage");
  const long = tagText(xml, "LongMessage");
  const code = tagText(xml, "ErrorCode");
  const detail = long ?? short ?? "eBay reported an unspecified error.";
  throw new MarketplaceError(code ? `eBay error ${code}: ${detail}` : `eBay error: ${detail}`);
}

export function parseGetBestOffers(xml: string): MarketplaceOffer[] {
  assertAckOk(xml);

  return tagBlocks(xml, "BestOffer").flatMap((block) => {
    const id = tagText(block, "BestOfferID");
    const priceText = tagText(block, "Price");
    if (id === null || priceText === null) return [];

    const amount = Number(priceText);
    if (!Number.isFinite(amount) || amount <= 0) return [];

    const counterText = tagText(block, "CounterOfferPrice");
    const counterAmount = counterText === null ? undefined : Number(counterText);

    const buyerMessage = tagText(block, "BuyerMessage") ?? undefined;

    return [
      {
        marketplaceOfferId: id,
        amount,
        currency: currencyOf(block, "Price"),
        status: normalizeOfferStatus(tagText(block, "Status")),
        counterAmount:
          counterAmount !== undefined && Number.isFinite(counterAmount) && counterAmount > 0
            ? counterAmount
            : undefined,
        buyerMessage,
      },
    ];
  });
}

/** RespondToBestOffer returns no body we need — success is the Ack. */
export function parseRespondToBestOffer(xml: string): void {
  assertAckOk(xml);
}

export function parseGetItemSaleStatus(xml: string): { sold: boolean; soldPrice?: number } {
  assertAckOk(xml);

  const sellingStatus = tagBlocks(xml, "SellingStatus")[0] ?? "";
  const state = (tagText(sellingStatus, "ListingStatus") ?? "").trim().toLowerCase();
  const quantitySoldText = tagText(sellingStatus, "QuantitySold");
  const quantitySold = quantitySoldText === null ? 0 : Number(quantitySoldText);

  const sold = quantitySold > 0 || state === "completed";
  if (!sold) return { sold: false };

  const priceText = tagText(sellingStatus, "CurrentPrice");
  const soldPrice = priceText === null ? undefined : Number(priceText);

  return {
    sold: true,
    soldPrice: soldPrice !== undefined && Number.isFinite(soldPrice) ? soldPrice : undefined,
  };
}

/**
 * Pass null when authenticating with an OAuth access token — that goes in the
 * X-EBAY-API-IAF-TOKEN header instead, and RequesterCredentials is omitted.
 * The legacy Auth'n'Auth token form is kept for completeness.
 */
function credentials(authToken: string | null): string {
  if (authToken === null) return "";
  return `<RequesterCredentials><eBayAuthToken>${escapeXml(authToken)}</eBayAuthToken></RequesterCredentials>`;
}

export function buildGetBestOffers(authToken: string | null, itemId: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetBestOffersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  ${credentials(authToken)}
  <ItemID>${escapeXml(itemId)}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
</GetBestOffersRequest>`;
}

const ACTION_MAP = {
  accept: "Accept",
  decline: "Decline",
  counter: "Counter",
} as const;

export function buildRespondToBestOffer(
  authToken: string | null,
  input: {
    itemId: string;
    bestOfferId: string;
    action: keyof typeof ACTION_MAP;
    counterAmount?: number;
  },
): string {
  const counter =
    input.action === "counter" && input.counterAmount !== undefined
      ? `\n  <CounterOfferPrice currencyID="USD">${input.counterAmount}</CounterOfferPrice>\n  <CounterOfferQuantity>1</CounterOfferQuantity>`
      : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<RespondToBestOfferRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  ${credentials(authToken)}
  <ItemID>${escapeXml(input.itemId)}</ItemID>
  <BestOfferID>${escapeXml(input.bestOfferId)}</BestOfferID>
  <Action>${ACTION_MAP[input.action]}</Action>${counter}
</RespondToBestOfferRequest>`;
}

export function buildGetItem(authToken: string | null, itemId: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  ${credentials(authToken)}
  <ItemID>${escapeXml(itemId)}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`;
}
