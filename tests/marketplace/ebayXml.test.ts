/**
 * Lives outside `convex/` on purpose: Convex's default runtime is a V8 isolate
 * with no Node builtins, so a test that reads fixtures off disk can't sit in
 * the bundled directory. The fixtures themselves stay beside the adapter.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGetBestOffers,
  buildRespondToBestOffer,
  normalizeOfferStatus,
  parseGetBestOffers,
  parseGetItemSaleStatus,
  parseRespondToBestOffer,
} from "../../convex/marketplace/ebayXml";
import { MarketplaceError } from "../../convex/marketplace/types";

const FIXTURES = join(__dirname, "..", "..", "convex", "marketplace", "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.xml`), "utf8");

describe("parseGetBestOffers", () => {
  it("normalises a received offer", () => {
    const offers = parseGetBestOffers(fixture("offer-received"));

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      marketplaceOfferId: "1122334455",
      amount: 245,
      currency: "USD",
      status: "pending",
      buyerMessage: "Would you take 245?",
    });
    expect(offers[0].counterAmount).toBeUndefined();
  });

  it("returns nothing for an empty offer array", () => {
    expect(parseGetBestOffers(fixture("no-offers"))).toEqual([]);
  });

  it("maps an accepted offer", () => {
    expect(parseGetBestOffers(fixture("offer-accepted"))[0].status).toBe("accepted");
  });

  it("maps a declined offer", () => {
    expect(parseGetBestOffers(fixture("offer-declined"))[0].status).toBe("declined");
  });

  it("carries the counter amount through a countered offer", () => {
    const [offer] = parseGetBestOffers(fixture("offer-countered"));
    expect(offer.status).toBe("countered");
    expect(offer.amount).toBe(245);
    expect(offer.counterAmount).toBe(260);
  });

  it("throws a readable error when eBay reports a failure", () => {
    expect(() => parseGetBestOffers(fixture("api-error"))).toThrow(MarketplaceError);
    expect(() => parseGetBestOffers(fixture("api-error"))).toThrow(/eBay error 17/);
    expect(() => parseGetBestOffers(fixture("api-error"))).toThrow(/not valid/);
  });
});

describe("normalizeOfferStatus", () => {
  it("treats unknown and inactive states as non-actionable", () => {
    // The property that matters: nothing unrecognised may surface as "pending",
    // or the owner gets asked to act on an offer that isn't actually open.
    for (const raw of ["Retracted", "AdminEnded", "Expired", "Wat", "", null]) {
      expect(normalizeOfferStatus(raw)).toBe("expired");
    }
  });

  it("is case and whitespace insensitive", () => {
    expect(normalizeOfferStatus("  pending ")).toBe("pending");
    expect(normalizeOfferStatus("ACCEPTED")).toBe("accepted");
  });
});

describe("parseRespondToBestOffer", () => {
  it("accepts a success ack", () => {
    expect(() => parseRespondToBestOffer(fixture("respond-success"))).not.toThrow();
  });

  it("throws on a failure ack", () => {
    expect(() => parseRespondToBestOffer(fixture("api-error"))).toThrow(MarketplaceError);
  });
});

describe("parseGetItemSaleStatus", () => {
  it("reports a completed sale and its price", () => {
    expect(parseGetItemSaleStatus(fixture("item-sold"))).toEqual({
      sold: true,
      soldPrice: 260,
    });
  });
});

describe("request builders", () => {
  it("includes the auth token and item id", () => {
    const xml = buildGetBestOffers("tok-123", "110012345678");
    expect(xml).toContain("<eBayAuthToken>tok-123</eBayAuthToken>");
    expect(xml).toContain("<ItemID>110012345678</ItemID>");
  });

  it("emits a counter price only for a counter", () => {
    const counter = buildRespondToBestOffer("tok", {
      itemId: "1",
      bestOfferId: "2",
      action: "counter",
      counterAmount: 260,
    });
    expect(counter).toContain("<Action>Counter</Action>");
    expect(counter).toContain('<CounterOfferPrice currencyID="USD">260</CounterOfferPrice>');

    const accept = buildRespondToBestOffer("tok", {
      itemId: "1",
      bestOfferId: "2",
      action: "accept",
    });
    expect(accept).toContain("<Action>Accept</Action>");
    expect(accept).not.toContain("CounterOfferPrice");
  });

  it("escapes values so a token can't break the document", () => {
    expect(buildGetBestOffers("a&b<c", "1")).toContain("a&amp;b&lt;c");
  });
});
